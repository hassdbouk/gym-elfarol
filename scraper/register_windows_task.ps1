# Register a 30-minute poll of westernusc.ca/wsrc-status.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File scraper/register_windows_task.ps1

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmdPath = Join-Path $scriptDir "run_live_poll.cmd"
$taskName = "GymElFarol-WSRC-Poller"

if (-not (Test-Path $cmdPath)) {
    throw "Missing $cmdPath"
}

# Prefer the Python installer (XML task: infinite 30-min repeat, allowed on battery).
$python = "C:\Users\hass\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$poller = Join-Path $scriptDir "live_poll.py"
if (Test-Path $python) {
    & $python $poller --install-task
    if ($LASTEXITCODE -ne 0) { throw "live_poll.py --install-task failed ($LASTEXITCODE)" }
} else {
    schtasks /Create /TN $taskName /SC DAILY /ST 00:00 /RI 30 /DU 24:00 /F /RL LIMITED /TR "`"$cmdPath`""
    if ($LASTEXITCODE -ne 0) {
        throw "schtasks /Create failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Registered $taskName (every 30 minutes)."
schtasks /Query /TN $taskName /FO LIST /V
