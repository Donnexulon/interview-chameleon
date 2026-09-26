@echo off
setlocal
cd /d "%~dp0"

echo Interview Chameleon local setup
echo.

set "PY_CMD="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PY_CMD=py -3"
)

if not defined PY_CMD (
  where python >nul 2>nul
  if not errorlevel 1 set "PY_CMD=python"
)

if not defined PY_CMD (
  echo Python 3 was not found.
  echo Install Python 3.9+ from https://www.python.org/downloads/ and enable "Add python.exe to PATH".
  exit /b 1
)

echo Using Python:
%PY_CMD% --version

if not exist "venv\Scripts\python.exe" (
  echo.
  echo Creating virtual environment...
  %PY_CMD% -m venv venv
  if errorlevel 1 (
    echo Failed to create venv.
    exit /b 1
  )
) else (
  echo.
  echo Existing virtual environment found.
)

echo.
echo Installing Python dependencies...
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 (
  echo Dependency install failed.
  exit /b 1
)

echo.
echo Setup complete.
echo Next steps:
echo   1. Start Ollama.
echo   2. Install the local model: ollama pull qwen2.5:7b
echo   3. Run diagnostics: doctor.bat
echo   4. Start the app: run_demo.bat
echo Speech input uses the packaged faster-whisper audio runtime; system FFmpeg is not required.

endlocal
