@echo off
REM Refresh rapido: Simulation + Accuracy, preserva P&L inseriti (no orchestrator full).

cd /d "%~dp0.."

call "%~dp0_grafici_pick_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

echo [Fast refresh] Python: %GRAFICI_PY%
set PYTHONUNBUFFERED=1
set DAILY_REFRESH_FAST=1

"%GRAFICI_PY%" -u launch_refresh_fast.py %*
if errorlevel 1 (
  echo.
  echo Esempi:
  echo   python launch_refresh_fast.py
  echo   python launch_refresh_fast.py --dry-run
  echo   python launch_refresh_fast.py --no-live-pred
  echo   python launch_refresh_fast.py --update-json-outcomes
  pause
  exit /b 1
)

exit /b 0
