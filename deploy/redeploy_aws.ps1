<#
.SYNOPSIS
  TV1 (A04/A06/K13) - Zero-DB-loss redeploy of a new application commit to Elastic Beanstalk.
  Proves that updating the application version preserves the independent PostgreSQL database
  and existing published handover packages (K13).
#>
[CmdletBinding()]
param(
    [string]$ProjectName = "nhom5-handover",
    [string]$Region = "us-east-1",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$Identity = (aws sts get-caller-identity --region $Region --output json) | ConvertFrom-Json
$AccountId = $Identity.Account
$GitCommit = (git rev-parse --short=12 HEAD).Trim()
$VersionLabel = "v-$GitCommit-$(Get-Date -Format 'yyyyMMddHHmmss')"

if (-not $SkipBuild) {
    Push-Location (Join-Path $RepoRoot "backend")
    .\mvnw.cmd -B -ntp clean package -DskipTests
    Pop-Location
    Push-Location (Join-Path $RepoRoot "frontend")
    npm ci --no-audit --no-fund
    npx vite build --base=/portal/
    Pop-Location
}

python deploy/build_eb_bundle.py | Out-Null

$ArtifactBucket = "$ProjectName-artifacts-$AccountId-$Region"
$EbKey = "releases/eb-release-$VersionLabel.zip"
aws s3 cp output/eb-release.zip "s3://$ArtifactBucket/$EbKey" --region $Region

$EbApp = "$ProjectName-app"
$EbEnv = "$ProjectName-env"

Write-Host "Creating Elastic Beanstalk ApplicationVersion $VersionLabel (commit $GitCommit)..."
aws elasticbeanstalk create-application-version `
    --region $Region `
    --application-name $EbApp `
    --version-label $VersionLabel `
    --description "Commit $GitCommit" `
    --source-bundle S3Bucket=$ArtifactBucket,S3Key=$EbKey | Out-Null

Write-Host "Updating environment $EbEnv to $VersionLabel (independent RDS is untouched)..."
aws elasticbeanstalk update-environment `
    --region $Region `
    --environment-name $EbEnv `
    --version-label $VersionLabel | Out-Null

Write-Host "Waiting for environment $EbEnv to become Ready..."
aws elasticbeanstalk wait environment-updated `
    --region $Region `
    --environment-names $EbEnv

$EnvInfo = (aws elasticbeanstalk describe-environments `
    --region $Region `
    --environment-names $EbEnv `
    --query "Environments[0].{Status:Status,Health:Health,VersionLabel:VersionLabel,EndpointURL:EndpointURL}" `
    --output json)
Write-Host "Redeploy complete:"
Write-Host $EnvInfo
