param(
    [string]$RuntimeDir = (Join-Path $PSScriptRoot '..\dist5\win-unpacked\runtime')
)

$ErrorActionPreference = 'Stop'
$exe = Join-Path $RuntimeDir 'TgWsProxy_windows.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "TgWsProxy not found: $exe" }

$procs = @(Get-Process -Name 'TgWsProxy_windows' -ErrorAction SilentlyContinue)
foreach ($p in $procs) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { Write-Warning "Cannot stop PID $($p.Id): $($_.Exception.Message)" }
}
Start-Sleep -Seconds 2
$still = @(Get-Process -Name 'TgWsProxy_windows' -ErrorAction SilentlyContinue)
if ($still.Count -gt 0) { throw "TgWsProxy still running: $($still.Id -join ',')" }

Start-Process -FilePath $exe -WorkingDirectory $RuntimeDir
Start-Sleep -Seconds 4
$new = @(Get-Process -Name 'TgWsProxy_windows' -ErrorAction SilentlyContinue)
Write-Output "TgWsProxy restarted: $($new.Id -join ',')"
