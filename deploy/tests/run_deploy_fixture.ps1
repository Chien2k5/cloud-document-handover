param([string]$ScriptPath, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
foreach ($tool in @('aws','git','python','npm','npx')) {
    $resolved = (Get-Command $tool -ErrorAction Stop).Source
    if (-not $resolved.StartsWith((Join-Path $FixtureRoot 'bin'), [StringComparison]::OrdinalIgnoreCase)) { throw "Unstubbed tool: $tool" }
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $Method)
    if (-not "$Uri".Contains('.fixture.invalid')) { throw 'Unstubbed HTTP destination' }
    return @{status=$env:WAVE1_APP_HEALTH}
}
Set-Location (Join-Path $FixtureRoot 'caller')
$before=(Get-Location).Path
$success=$true; $message=''
try {
    if ($ScriptPath.EndsWith('redeploy_aws.ps1')) { & $ScriptPath }
    else { & $ScriptPath -VpcId vpc-fixture -AppSubnetIdsCsv 'subnet-a,subnet-b' -DbSubnetIdsCsv 'subnet-c,subnet-d' }
} catch { $success=$false; $message=$_.Exception.Message }
Write-Output ('FIXTURE_RESULT:' + (@{success=$success;message=$message;before=$before;after=(Get-Location).Path;engine=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress))
