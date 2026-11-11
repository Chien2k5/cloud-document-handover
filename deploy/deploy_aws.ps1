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


function Invoke-Native([string]$Step, [string]$Command, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0)) {
    # Capture both streams: native diagnostics can include credential-bearing arguments.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $global:LASTEXITCODE = 0
    try {
        $null = Get-Command $Command -ErrorAction Stop
        $captured = @(& $Command @Arguments 2>&1)
        $code = $LASTEXITCODE
    }
    catch { throw "$Step could not start." }
    if ($AllowedExitCodes -notcontains $code) { throw "$Step failed (exit $code)." }
    return [pscustomobject]@{ ExitCode = $code; Output = ($captured -join "`n") }
}

function Read-Json([string]$Text, [string]$Step) {
    try { return ($Text | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "$Step returned invalid JSON." }
}

function Assert-Artifact([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -eq 0) {
        throw "The current artifact builder did not create a nonempty release ZIP."
    }
}

function Assert-EbRelease([string]$Environment, [string]$ExpectedVersion, [string]$Region) {
    if (-not $ExpectedVersion -or $ExpectedVersion -eq 'None') { throw 'Expected application version is missing.' }
    Invoke-Native 'EB environment waiter' 'aws' @('elasticbeanstalk','wait','environment-updated','--region',$Region,'--environment-names',$Environment) | Out-Null
    $response = Invoke-Native 'EB release inspection' 'aws' @('elasticbeanstalk','describe-environments','--region',$Region,'--environment-names',$Environment,'--query','Environments[0].{Status:Status,Health:Health,VersionLabel:VersionLabel,EndpointURL:EndpointURL}','--output','json')
    $info = Read-Json $response.Output 'EB release inspection'
    if ($info.Status -ne 'Ready' -or $info.Health -ne 'Green' -or $info.VersionLabel -cne $ExpectedVersion) {
        throw 'EB did not reach Ready/Green with the expected application version.'
    }
    if ($info.EndpointURL -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]+$') { throw 'EB endpoint is missing or invalid.' }
    try { $health = Invoke-RestMethod -Uri ("http://" + $info.EndpointURL + '/api/v1/health') -TimeoutSec 15 }
    catch { throw 'Application health endpoint could not be verified.' }
    if ($health.status -cne 'UP') { throw 'Application health endpoint did not return UP.' }
}

$ErrorActionPreference = 'Stop'
$OriginalLocation = Get-Location
$DbPasswordPlain = $null
try {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Set-Location $RepoRoot
    $identityResponse = Invoke-Native 'AWS caller identity' 'aws' @('sts','get-caller-identity','--region',$Region,'--output','json')
    $Identity = Read-Json $identityResponse.Output 'AWS caller identity'
    $AccountId = $Identity.Account
    if ($AccountId -notmatch '^\d{12}$') { throw 'AWS caller identity did not return an account ID.' }
    $GitCommit = (Invoke-Native 'Git source identity' 'git' @('rev-parse','--short=12','HEAD')).Output.Trim()
    if ($GitCommit -notmatch '^[0-9a-f]{12}$') { throw 'Git source identity is invalid.' }
function Get-EbSolutionStack([string]$Override, [string]$Region) {
    if ($Override) { return $Override }
    $ErrorActionPreference = "Continue"
    $global:LASTEXITCODE = 0
    $response = @(aws elasticbeanstalk list-available-solution-stacks --region $Region --output json 2>&1)
    $ErrorActionPreference = "Stop"
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
        Set-Location (Join-Path $RepoRoot 'backend')
        Invoke-Native 'Maven build' '.\mvnw.cmd' @('-B','-ntp','clean','package','-DskipTests') | Out-Null
        Set-Location (Join-Path $RepoRoot 'frontend')
        Invoke-Native 'npm ci' 'npm' @('ci','--no-audit','--no-fund') | Out-Null
        Invoke-Native 'Vite build' 'npx' @('vite','build','--base=/portal/') | Out-Null
        Set-Location $RepoRoot
    }
    # A fresh path prevents a successful-looking builder from reusing an old ZIP.
    $ReleaseId = "$GitCommit-$([guid]::NewGuid().ToString('N'))"
    $EbBundle = Join-Path $RepoRoot "output/eb-release-$ReleaseId.zip"
    $LambdaBundle = Join-Path $RepoRoot "output/lambda-checksum-$ReleaseId.zip"
    Invoke-Native 'EB bundle builder' 'python' @('deploy/build_eb_bundle.py','--output',$EbBundle) | Out-Null
    Assert-Artifact $EbBundle
    Invoke-Native 'Lambda ZIP builder' 'python' @('deploy/build_lambda_zip.py','--output',$LambdaBundle) | Out-Null
    Assert-Artifact $LambdaBundle
    $ArtifactBucket = "$ProjectName-artifacts-$AccountId-$Region"
    $bucket = Invoke-Native 'Artifact bucket lookup' 'aws' @('s3api','head-bucket','--bucket',$ArtifactBucket,'--region',$Region) @(0,254)
    if ($bucket.ExitCode -ne 0) {
        if ($bucket.Output -notmatch '\(404\)|NoSuchBucket|Not Found') { throw 'Artifact bucket lookup was denied or failed; not creating a replacement.' }
        $createArgs = @('s3api','create-bucket','--bucket',$ArtifactBucket,'--region',$Region)
        if ($Region -ne 'us-east-1') { $createArgs += @('--create-bucket-configuration',"LocationConstraint=$Region") }
        Invoke-Native 'Artifact bucket creation' 'aws' $createArgs | Out-Null
        Invoke-Native 'Artifact bucket public access block' 'aws' @('s3api','put-public-access-block','--bucket',$ArtifactBucket,'--region',$Region,'--public-access-block-configuration','BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true') | Out-Null
        Invoke-Native 'Artifact bucket encryption' 'aws' @('s3api','put-bucket-encryption','--bucket',$ArtifactBucket,'--region',$Region,'--server-side-encryption-configuration','{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}') | Out-Null
    }
    $EbKey = "releases/eb-release-$ReleaseId.zip"
    $LambdaKey = "lambda/lambda-checksum-$ReleaseId.zip"
    Invoke-Native 'EB artifact upload' 'aws' @('s3','cp',$EbBundle,"s3://$ArtifactBucket/$EbKey",'--region',$Region) | Out-Null
    Invoke-Native 'Lambda artifact upload' 'aws' @('s3','cp',$LambdaBundle,"s3://$ArtifactBucket/$LambdaKey",'--region',$Region) | Out-Null
    $StorageStack = "$ProjectName-storage"
    Invoke-Native 'Storage CloudFormation deploy' 'aws' @('cloudformation','deploy','--region',$Region,'--stack-name',$StorageStack,'--template-file','infra/cloudformation/00-storage.yaml','--capabilities','CAPABILITY_NAMED_IAM','--no-fail-on-empty-changeset','--parameter-overrides',"ProjectName=$ProjectName","UseLabRole=$UseLabRole","LambdaCodeBucket=$ArtifactBucket","LambdaCodeKey=$LambdaKey") | Out-Null
    if ($env:DB_MASTER_PASSWORD) { $DbPasswordPlain = $env:DB_MASTER_PASSWORD }
    else {
        $SecurePwd = Read-Host 'Enter RDS Master Password (16-64 chars, not echoed)' -AsSecureString
        $DbPasswordPlain = [System.Net.NetworkCredential]::new('', $SecurePwd).Password
    }
    $AppStack = "$ProjectName-app"
    $EbServiceRole = if ($UseLabRole -eq 'true') { 'LabRole' } else { 'aws-elasticbeanstalk-service-role' }
    Invoke-Native 'Application CloudFormation deploy' 'aws' @('cloudformation','deploy','--region',$Region,'--stack-name',$AppStack,'--template-file','infra/cloudformation/01-rds-beanstalk-cloudfront.yaml','--no-fail-on-empty-changeset','--parameter-overrides',"ProjectName=$ProjectName","StorageStackName=$StorageStack","VpcId=$VpcId","AppSubnetIds=$AppSubnetIdsCsv","DbSubnetIds=$DbSubnetIdsCsv","EbSolutionStackName=$EbSolutionStackName","EbServiceRoleName=$EbServiceRole","AppVersionBucket=$ArtifactBucket","AppVersionKey=$EbKey","DbMasterPassword=$DbPasswordPlain") | Out-Null
    $DbPasswordPlain = $null
    $PortalOrigin = (Invoke-Native 'Portal origin lookup' 'aws' @('cloudformation','describe-stacks','--region',$Region,'--stack-name',$AppStack,'--query',"Stacks[0].Outputs[?OutputKey=='PortalOriginForCors'].OutputValue",'--output','text')).Output.Trim()
    $PortalUrl = (Invoke-Native 'Portal URL lookup' 'aws' @('cloudformation','describe-stacks','--region',$Region,'--stack-name',$AppStack,'--query',"Stacks[0].Outputs[?OutputKey=='PortalHttpsUrl'].OutputValue",'--output','text')).Output.Trim()
    if ($PortalOrigin -notmatch '^https://[^/\s]+$' -or $PortalUrl -notmatch '^https://[^\s]+/portal/$') { throw 'CloudFormation portal outputs are invalid.' }
    Invoke-Native 'Storage CORS update' 'aws' @('cloudformation','deploy','--region',$Region,'--stack-name',$StorageStack,'--template-file','infra/cloudformation/00-storage.yaml','--capabilities','CAPABILITY_NAMED_IAM','--no-fail-on-empty-changeset','--parameter-overrides',"ProjectName=$ProjectName","UseLabRole=$UseLabRole","PortalOrigin=$PortalOrigin","LambdaCodeBucket=$ArtifactBucket","LambdaCodeKey=$LambdaKey") | Out-Null
    $ExpectedVersion = (Invoke-Native 'CloudFormation application version lookup' 'aws' @('cloudformation','describe-stack-resource','--region',$Region,'--stack-name',$AppStack,'--logical-resource-id','HandoverEbAppVersion','--query','StackResourceDetail.PhysicalResourceId','--output','text')).Output.Trim()
    Assert-EbRelease "$ProjectName-env" $ExpectedVersion $Region
    Write-Host "Deployment finished. Portal HTTPS URL: $PortalUrl"
} finally {
    $DbPasswordPlain = $null
    Set-Location $OriginalLocation
}
