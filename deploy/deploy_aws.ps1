<#
.SYNOPSIS
  TV1 (A03/A04) - End-to-end AWS deployment script for Cloud Document Handover.
  Supports AWS Academy Learner Lab (UseLabRole=true, default) and normal AWS accounts (UseLabRole=false).

.DESCRIPTION
  1. Verifies AWS CLI caller identity and target Region.
  2. Builds backend JAR, frontend /portal/ dist, eb-release.zip, and lambda-checksum.zip.
  3. Creates/reuses a private deployment artifact S3 bucket and uploads both ZIPs.
  4. Deploys stack 00-storage.yaml (Upload S3 + Versioning + Checksum Lambda + Backup S3 + Alarms).
  5. Deploys stack 01-rds-beanstalk-cloudfront.yaml (Independent RDS PostgreSQL 17 + Beanstalk Corretto 21 + CloudFront HTTPS).
  6. Updates 00-storage.yaml PortalOrigin parameter with the real CloudFront HTTPS origin so S3 CORS matches.
  7. Prints non-secret deployment record JSON.
#>
[CmdletBinding()]
param(
    [string]$ProjectName = "nhom5-handover",
    [string]$Region = "us-east-1",
    [ValidateSet("true", "false")]
    [string]$UseLabRole = "true",
    [Parameter(Mandatory = $true)]
    [string]$VpcId,
    [Parameter(Mandatory = $true)]
    [string]$AppSubnetIdsCsv,
    [Parameter(Mandatory = $true)]
    [string]$DbSubnetIdsCsv,
    [string]$EbSolutionStackName = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

Write-Host "[1/7] Checking AWS caller identity in region $Region..."
$IdentityJson = aws sts get-caller-identity --region $Region --output json
if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI is not authenticated. Configure AWS Academy Learner Lab credentials first."
}
$Identity = $IdentityJson | ConvertFrom-Json
$AccountId = $Identity.Account
$GitCommit = (git rev-parse --short=12 HEAD).Trim()
Write-Host "      Account: $AccountId | Principal: $($Identity.Arn) | Commit: $GitCommit"

function Get-EbSolutionStack([string]$Override, [string]$Region) {
    if ($Override) { return $Override }
    $response = aws elasticbeanstalk list-available-solution-stacks --region $Region --output json
    if ($LASTEXITCODE -ne 0) { throw "Elastic Beanstalk platform discovery failed." }
    try { $document = ($response -join "`n") | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Elastic Beanstalk platform discovery returned invalid JSON." }
    if ($null -eq $document -or $document.SolutionStacks -isnot [array]) {
        throw "Elastic Beanstalk platform discovery requires a SolutionStacks array."
    }
    $candidates = @(
        foreach ($name in $document.SolutionStacks) {
            if ($name -isnot [string]) { throw "Elastic Beanstalk returned a non-string solution stack." }
            $match = [regex]::Match($name, '^64bit Amazon Linux 2023 v(?<Version>\d+\.\d+\.\d+(?:\.\d+)?) running Corretto 21$')
            if ($match.Success) {
                [pscustomobject]@{ Name = $name; Version = [version]$match.Groups['Version'].Value }
            }
        }
    )
    if (-not $candidates.Count) {
        throw "No Java SE Corretto 21 Amazon Linux 2023 solution stack is available in $Region. Pass -EbSolutionStackName explicitly."
    }
    $ordered = @($candidates | Sort-Object @{ Expression = { $_.Version }; Descending = $true }, @{ Expression = { $_.Name }; Descending = $true })
    return $ordered[0].Name
}

$EbSolutionStackName = Get-EbSolutionStack -Override $EbSolutionStackName -Region $Region
Write-Host "      EB Solution Stack: $EbSolutionStackName"

if (-not $SkipBuild) {
    Write-Host "[2/7] Building backend JAR and frontend /portal/ static bundle..."
    Push-Location (Join-Path $RepoRoot "backend")
    .\mvnw.cmd -B -ntp clean package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed." }
    Pop-Location

    Push-Location (Join-Path $RepoRoot "frontend")
    npm ci --no-audit --no-fund
    npx vite build --base=/portal/
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
    Pop-Location
}

Write-Host "[3/7] Packaging eb-release.zip and lambda-checksum.zip..."
python deploy/build_eb_bundle.py | Out-Null
python deploy/build_lambda_zip.py | Out-Null

$ArtifactBucket = "$ProjectName-artifacts-$AccountId-$Region"
Write-Host "[4/7] Ensuring private artifact bucket s3://$ArtifactBucket ..."
aws s3api head-bucket --bucket $ArtifactBucket --region $Region 2>$null
if ($LASTEXITCODE -ne 0) {
    if ($Region -eq "us-east-1") {
        aws s3api create-bucket --bucket $ArtifactBucket --region $Region | Out-Null
    } else {
        aws s3api create-bucket --bucket $ArtifactBucket --region $Region `
            --create-bucket-configuration LocationConstraint=$Region | Out-Null
    }
    aws s3api put-public-access-block --bucket $ArtifactBucket --region $Region `
        --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    aws s3api put-bucket-encryption --bucket $ArtifactBucket --region $Region `
        --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
}

$EbKey = "releases/eb-release-$GitCommit.zip"
$LambdaKey = "lambda/lambda-checksum-$GitCommit.zip"
aws s3 cp output/eb-release.zip "s3://$ArtifactBucket/$EbKey" --region $Region
aws s3 cp output/lambda-checksum.zip "s3://$ArtifactBucket/$LambdaKey" --region $Region

$StorageStack = "$ProjectName-storage"
Write-Host "[5/7] Deploying CloudFormation stack $StorageStack (00-storage.yaml)..."
aws cloudformation deploy `
    --region $Region `
    --stack-name $StorageStack `
    --template-file infra/cloudformation/00-storage.yaml `
    --capabilities CAPABILITY_NAMED_IAM `
    --no-fail-on-empty-changeset `
    --parameter-overrides `
        ProjectName=$ProjectName `
        UseLabRole=$UseLabRole `
        LambdaCodeBucket=$ArtifactBucket `
        LambdaCodeKey=$LambdaKey

if (-not $env:DB_MASTER_PASSWORD) {
    $SecurePwd = Read-Host "Enter RDS Master Password (16-64 chars, not echoed)" -AsSecureString
    $DbPasswordPlain = [System.Net.NetworkCredential]::new("", $SecurePwd).Password
} else {
    $DbPasswordPlain = $env:DB_MASTER_PASSWORD
}

$AppStack = "$ProjectName-app"
$EbServiceRole = if ($UseLabRole -eq "true") { "LabRole" } else { "aws-elasticbeanstalk-service-role" }
Write-Host "[6/7] Deploying CloudFormation stack $AppStack (01-rds-beanstalk-cloudfront.yaml)..."
aws cloudformation deploy `
    --region $Region `
    --stack-name $AppStack `
    --template-file infra/cloudformation/01-rds-beanstalk-cloudfront.yaml `
    --no-fail-on-empty-changeset `
    --parameter-overrides `
        ProjectName=$ProjectName `
        StorageStackName=$StorageStack `
        VpcId=$VpcId `
        AppSubnetIds=$AppSubnetIdsCsv `
        DbSubnetIds=$DbSubnetIdsCsv `
        EbSolutionStackName="$EbSolutionStackName" `
        EbServiceRoleName=$EbServiceRole `
        AppVersionBucket=$ArtifactBucket `
        AppVersionKey=$EbKey `
        DbMasterPassword=$DbPasswordPlain

$DbPasswordPlain = $null

$PortalOrigin = (aws cloudformation describe-stacks --region $Region --stack-name $AppStack `
    --query "Stacks[0].Outputs[?OutputKey=='PortalOriginForCors'].OutputValue" --output text).Trim()
$PortalUrl = (aws cloudformation describe-stacks --region $Region --stack-name $AppStack `
    --query "Stacks[0].Outputs[?OutputKey=='PortalHttpsUrl'].OutputValue" --output text).Trim()

Write-Host "[7/7] Updating S3 CORS PortalOrigin on $StorageStack to $PortalOrigin ..."
aws cloudformation deploy `
    --region $Region `
    --stack-name $StorageStack `
    --template-file infra/cloudformation/00-storage.yaml `
    --capabilities CAPABILITY_NAMED_IAM `
    --no-fail-on-empty-changeset `
    --parameter-overrides `
        ProjectName=$ProjectName `
        UseLabRole=$UseLabRole `
        PortalOrigin=$PortalOrigin `
        LambdaCodeBucket=$ArtifactBucket `
        LambdaCodeKey=$LambdaKey

Write-Host "Deployment finished. Portal HTTPS URL: $PortalUrl"
