@echo off
setlocal

REM One-click updater for Biotech Investment workbook
cd /d "%~dp0"

set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [ERROR] Virtual environment python not found: %PY%
  echo Create/restore .venv first, then retry.
  pause
  exit /b 1
)

echo [RUN] Updating Excel output...
"%PY%" "data_orchestrator.py"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [FAILED] data_orchestrator.py exited with code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo [OK] Update completed successfully.
pause
exit /b 0

