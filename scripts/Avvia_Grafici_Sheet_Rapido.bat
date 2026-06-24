@echo off
REM Grafici veloce: senza --refresh, GRAFICI_FAST=1 (cache HistLib).
cd /d "%~dp0.."
call "%~dp0_grafici_pick_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
echo [Grafici] Python: %GRAFICI_PY%
"%GRAFICI_PY%" -c "import sklearn" 2>nul
if errorlevel 1 (
  "%GRAFICI_PY%" -m pip install scikit-learn 2>nul
  "%GRAFICI_PY%" -c "import sklearn" 2>nul
  if errorlevel 1 (
    echo [Grafici] sklearn mancante - vedi Avvia_Grafici_Sheet.bat
    pause
    exit /b 1
  )
)
set GRAFICI_FAST=1
set PYTHONUNBUFFERED=1
echo [Grafici rapido] GRAFICI_FAST=1, senza --refresh
"%GRAFICI_PY%" -u launch_grafici_sheet.py %*
if errorlevel 1 pause
exit /b %ERRORLEVEL%
