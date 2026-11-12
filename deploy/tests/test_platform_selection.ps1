$ErrorActionPreference = 'Stop'
$SourcePath = Join-Path $PSScriptRoot '../deploy_aws.ps1'
$source = Get-Content -LiteralPath $SourcePath -Raw
$start = $source.IndexOf('function Get-EbSolutionStack')
if ($start -lt 0) { $start = $source.IndexOf('if (-not $EbSolutionStackName)') }
$end = $source.IndexOf('Write-Host "      EB Solution Stack:')
$selection = [scriptblock]::Create($source.Substring($start, $end - $start))
$script:ApiCalls = 0
$script:ApiExit = 0
$script:ApiShape = $null
$script:Stacks = @()
function aws {
    $script:ApiCalls++
    $global:LASTEXITCODE = $script:ApiExit
    if ($script:ApiExit -ne 0) { return 'fixture API failure' }
    if ($null -ne $script:ApiShape) { return $script:ApiShape }
    if ($args -contains 'text') {
        $matches = @($script:Stacks | Where-Object { $_.Contains('AL2023') -and $_.Contains('Corretto 21') })
        if ($matches.Count) { return $matches[0] }
        return 'None'
    }
    return (@{ SolutionStacks = @($script:Stacks) } | ConvertTo-Json -Compress)
}
function Select-Platform($stacks, $override = '') {
    $script:ApiCalls = 0; $script:Stacks = @($stacks)
    $EbSolutionStackName = $override; $Region = 'us-east-1'
    . $selection
    return $EbSolutionStackName
}
function Assert-Equal($actual, $expected) {
    if ($actual -cne $expected) { throw "Expected [$expected], actual [$actual]" }
}
function Assert-Rejected([scriptblock]$action) {
    $rejected = $false
    try { & $action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected selector to reject this response' }
}
$java21 = '64bit Amazon Linux 2023 v4.9.2 running Corretto 21'
$java21New = '64bit Amazon Linux 2023 v4.10.0 running Corretto 21'
$java17 = '64bit Amazon Linux 2023 v4.10.0 running Corretto 17'
$tomcat = '64bit Amazon Linux 2023 v5.4.0 running Tomcat 10 Corretto 21'
$old = '64bit Amazon Linux 2 v4.10.0 running Corretto 21'
function Test-T001-01 { Assert-Equal (Select-Platform @($java21)) $java21 }
function Test-T001-02 { Assert-Equal (Select-Platform @($java17, $java21)) $java21 }
function Test-T001-03 { Assert-Equal (Select-Platform @($tomcat, $java21, $old)) $java21 }
function Test-T001-04 { Assert-Rejected { Select-Platform @($java17, $tomcat, $old) } }
function Test-T001-05 {
    $script:ApiExit = 42
    try { Assert-Rejected { Select-Platform @($java21) }; Assert-Equal $script:ApiCalls 1 } finally { $script:ApiExit = 0 }
}
function Test-T001-06 {
    foreach ($bad in @('', '{}', 'null', '{"SolutionStacks":"wrong"}', '{"SolutionStacks":[42]}', 'invalid json')) {
        $script:ApiShape = $bad
        Assert-Rejected { Select-Platform @() }
    }
    $script:ApiShape = $null
    Assert-Rejected { Select-Platform @() }
}
function Test-T001-07 {
    Assert-Equal (Select-Platform @() $java21) $java21
    Assert-Equal $script:ApiCalls 0
}
function Test-T001-08 {
    Assert-Equal (Select-Platform @($java21, $java21New)) $java21New
    Assert-Equal (Select-Platform @($java21New, $java21)) $java21New
}
$failed = 0
foreach ($id in 1..8) {
    $name = 'Test-T001-{0:d2}' -f $id
    $script:ApiShape = $null; $script:ApiExit = 0
    try { & $name; Write-Output "$name PASS" }
    catch { $failed++; Write-Output "$name FAIL: $($_.Exception.Message)" }
}
Write-Output "RESULT tests=8 failed=$failed engine=$($PSVersionTable.PSVersion)"
if ($failed) { exit 1 }
