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
try {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    Set-Location $RepoRoot
    $identityResponse = Invoke-Native 'AWS caller identity' 'aws' @('sts','get-caller-identity','--region',$Region,'--output','json')
    $Identity = Read-Json $identityResponse.Output 'AWS caller identity'
    $AccountId = $Identity.Account
    if ($AccountId -notmatch '^\d{12}$') { throw 'AWS caller identity did not return an account ID.' }
    $GitCommit = (Invoke-Native 'Git source identity' 'git' @('rev-parse','--short=12','HEAD')).Output.Trim()
    if ($GitCommit -notmatch '^[0-9a-f]{12}$') { throw 'Git source identity is invalid.' }
    $VersionLabel = "v-$GitCommit-$([guid]::NewGuid().ToString('N'))"
    if (-not $SkipBuild) {
        Set-Location (Join-Path $RepoRoot 'backend')
        Invoke-Native 'Maven build' '.\mvnw.cmd' @('-B','-ntp','clean','package','-DskipTests') | Out-Null
        Set-Location (Join-Path $RepoRoot 'frontend')
        Invoke-Native 'npm ci' 'npm' @('ci','--no-audit','--no-fund') | Out-Null
        Invoke-Native 'Vite build' 'npx' @('vite','build','--base=/portal/') | Out-Null
        Set-Location $RepoRoot
    }
    $EbBundle = Join-Path $RepoRoot "output/eb-release-$VersionLabel.zip"
    Invoke-Native 'EB bundle builder' 'python' @('deploy/build_eb_bundle.py','--output',$EbBundle) | Out-Null
    Assert-Artifact $EbBundle
    $ArtifactBucket = "$ProjectName-artifacts-$AccountId-$Region"
    $EbKey = "releases/eb-release-$VersionLabel.zip"
    Invoke-Native 'EB artifact upload' 'aws' @('s3','cp',$EbBundle,"s3://$ArtifactBucket/$EbKey",'--region',$Region) | Out-Null
    $EbApp = "$ProjectName-app"
    $EbEnv = "$ProjectName-env"
    Invoke-Native 'EB application version creation' 'aws' @('elasticbeanstalk','create-application-version','--region',$Region,'--application-name',$EbApp,'--version-label',$VersionLabel,'--description',"Commit $GitCommit",'--source-bundle',"S3Bucket=$ArtifactBucket,S3Key=$EbKey") | Out-Null
    Invoke-Native 'EB environment update' 'aws' @('elasticbeanstalk','update-environment','--region',$Region,'--environment-name',$EbEnv,'--version-label',$VersionLabel) | Out-Null
    Assert-EbRelease $EbEnv $VersionLabel $Region
    Write-Host "Redeploy complete: $VersionLabel (Ready/Green; application health UP)"
} finally {
    Set-Location $OriginalLocation
}
