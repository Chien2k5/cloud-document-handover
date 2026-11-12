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
    else {
        $extra=@{}
        if ($env:WAVE3_USE_LAB_ROLE) { $extra.UseLabRole=$env:WAVE3_USE_LAB_ROLE }
        if ($env:WAVE3_OPERATOR_ARN) { $extra.BackupOperatorPrincipalArn=$env:WAVE3_OPERATOR_ARN }
        if ($env:WAVE4_ALARM_EMAIL_SET -eq '1') { $extra.AlarmEmail=[string]$env:WAVE4_ALARM_EMAIL }
        & $ScriptPath -VpcId vpc-fixture -AppSubnetIdsCsv 'subnet-a,subnet-b' -DbSubnetIdsCsv 'subnet-c,subnet-d' @extra
    }
} catch { $success=$false; $message=$_.Exception.Message }
Write-Output ('FIXTURE_RESULT:' + (@{success=$success;message=$message;before=$before;after=(Get-Location).Path;engine=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress))
