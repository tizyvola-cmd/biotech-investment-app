@echo off
setlocal

REM Silent updater with timestamped log file
cd /d "%~dp0"

set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] Virtual environment python not found: %PY%
  exit /b 1
)

if not exist "logs" mkdir "logs"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%i
set "LOG=logs\run_%TS%.txt"

echo [RUN] %DATE% %TIME% > "%LOG%"
"%PY%" "data_orchestrator.py" >> "%LOG%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo [FAILED] Exit code %EXIT_CODE%. Log: %LOG%
  exit /b %EXIT_CODE%
)

echo [OK] Update completed. Log: %LOG%
exit /b 0

