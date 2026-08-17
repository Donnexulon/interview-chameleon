@echo off
setlocal
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo Could not find venv\Scripts\python.exe.
  echo Run install.bat before starting the app.
  pause
  exit /b 1
)

echo Starting Interview Chameleon on http://127.0.0.1:8000/
echo Use stop_demo.bat to stop the server safely.

for /f "tokens=*" %%A in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health -TimeoutSec 2 | Out-Null; Write-Output ready } catch { Write-Output missing }"') do set SERVER_STATE=%%A

if "%SERVER_STATE%"=="ready" (
  echo Existing server detected.
  echo If backend files changed, run stop_demo.bat first so the app reloads the latest code.
  start "" "http://127.0.0.1:8000/"
  endlocal
  exit /b 0
)

echo Launching FastAPI...
start "Interview Chameleon API" cmd /k "venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"

for /l %%I in (1,1,8) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto open_app
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1" >nul 2>nul
)

:open_app
start "" "http://127.0.0.1:8000/"

endlocal
