$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Failures = 0
$Warnings = 0
$RequiredModel = "qwen2.5:7b"
$VenvPython = Join-Path $Root "venv\Scripts\python.exe"

function Write-Check {
    param(
        [string]$Status,
        [string]$Message
    )
    Write-Host ("[{0}] {1}" -f $Status, $Message)
}

function Pass {
    param([string]$Message)
    Write-Check "OK" $Message
}

function Warn {
    param([string]$Message)
    $script:Warnings += 1
    Write-Check "WARN" $Message
}

function Fail {
    param([string]$Message)
    $script:Failures += 1
    Write-Check "FAIL" $Message
}

function Test-Command {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Port8000 {
    try {
        $Health = Invoke-RestMethod -UseBasicParsing "http://127.0.0.1:8000/health" -TimeoutSec 2
        if ($Health.status -eq "ok") {
            Pass "Port 8000 is already running Interview Chameleon."
            Warn "If backend code changed, run stop_demo.bat and then run_demo.bat."
            return
        }
    } catch {
        # Continue to listener check.
    }

    $Listeners = @()
    try {
        $Listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
    } catch {
        $Listeners = @()
    }

    if ($Listeners.Count -eq 0) {
        Pass "Port 8000 is available."
        return
    }

    foreach ($Connection in $Listeners) {
        $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($Connection.OwningProcess)" -ErrorAction SilentlyContinue
        $CommandLine = if ($ProcessInfo) { $ProcessInfo.CommandLine } else { "" }
        if ($CommandLine -match "uvicorn" -and $CommandLine -match "main:app") {
            Warn "Port 8000 is occupied by an app server that did not answer /health. Try stop_demo.bat."
        } else {
            Fail "Port 8000 is occupied by another process: PID $($Connection.OwningProcess) $CommandLine"
        }
    }
}

Write-Host "Interview Chameleon doctor"
Write-Host ""

if (Test-Command "py") {
    $Version = (& py -3 --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0) { Pass "Python launcher available: $Version" } else { Warn "py launcher exists but Python 3 failed." }
} elseif (Test-Command "python") {
    $Version = (& python --version 2>&1 | Out-String).Trim()
    Pass "python available: $Version"
} else {
    Fail "Python 3 was not found on PATH."
}

if (Test-Path $VenvPython) {
    $VenvVersion = (& $VenvPython --version 2>&1 | Out-String).Trim()
    Pass "Virtual environment available: $VenvVersion"
    & $VenvPython -c "import fastapi, uvicorn, pydantic, requests, docx, pypdf, faster_whisper; print('dependency imports ok')" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Pass "Required Python packages import successfully."
    } else {
        Fail "Python dependencies are incomplete. Run install.bat."
    }
} else {
    Fail "venv\Scripts\python.exe was not found. Run install.bat."
}

Pass "Speech decoding is provided by faster-whisper/PyAV; system FFmpeg is not required."

try {
    $OllamaTags = Invoke-RestMethod -UseBasicParsing "http://localhost:11434/api/tags" -TimeoutSec 5
    Pass "Ollama is reachable."
    $ModelNames = @($OllamaTags.models | ForEach-Object { $_.name })
    $HasQwen = $false
    foreach ($Name in $ModelNames) {
        if ($Name -eq $RequiredModel -or $Name -eq "$RequiredModel`:latest" -or $Name.StartsWith("$RequiredModel`:")) {
            $HasQwen = $true
        }
    }
    if ($HasQwen) {
        Pass "$RequiredModel is installed."
    } else {
        Fail "$RequiredModel is not installed. Run: ollama pull $RequiredModel"
    }
} catch {
    Fail "Ollama is not reachable at http://localhost:11434. Start Ollama, then rerun doctor.bat."
}

if (Test-Path $VenvPython) {
    $TmpDir = Join-Path $Root "tmp"
    New-Item -ItemType Directory -Path $TmpDir -Force | Out-Null
    $DbPath = Join-Path $TmpDir "doctor_write_test.db"
    & $VenvPython -c "import os, sqlite3, sys; path = sys.argv[1]; conn = sqlite3.connect(path); conn.execute('create table if not exists ok (id integer primary key)'); conn.execute('insert into ok default values'); conn.commit(); conn.close(); os.remove(path)" $DbPath
    if ($LASTEXITCODE -eq 0) {
        Pass "Local SQLite write test passed."
    } else {
        Fail "Local SQLite write test failed."
    }
}

Test-Port8000

Write-Host ""
if ($Failures -gt 0) {
    Write-Host "Doctor found $Failures failure(s) and $Warnings warning(s)."
    exit 1
}

Write-Host "Doctor passed with $Warnings warning(s)."
exit 0
