$ErrorActionPreference = "Stop"

$Stopped = 0
$Skipped = 0

try {
    $Listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
} catch {
    Write-Host "Could not inspect port 8000 with Get-NetTCPConnection."
    exit 1
}

if ($Listeners.Count -eq 0) {
    Write-Host "No process is listening on port 8000."
    exit 0
}

foreach ($Connection in $Listeners) {
    $ProcessId = $Connection.OwningProcess
    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    $CommandLine = if ($ProcessInfo) { $ProcessInfo.CommandLine } else { "" }

    if ($CommandLine -match "uvicorn" -and $CommandLine -match "main:app") {
        Write-Host "Stopping Interview Chameleon server on port 8000 (PID $ProcessId)."
        Stop-Process -Id $ProcessId -Force
        $Stopped += 1
    } else {
        Write-Host "Skipping non-app process on port 8000 (PID $ProcessId): $CommandLine"
        $Skipped += 1
    }
}

if ($Stopped -gt 0) {
    Write-Host "Stopped $Stopped app server process(es)."
}

if ($Skipped -gt 0) {
    Write-Host "Skipped $Skipped non-app process(es)."
    exit 1
}

exit 0
