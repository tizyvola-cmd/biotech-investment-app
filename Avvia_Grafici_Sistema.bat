@echo off
REM Grafici con Python di sistema (NON usa .venv - utile se il venv e' corrotto).
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo [Grafici] Python non trovato nel PATH.
  pause
  exit /b 1
)
echo [Grafici] Python di sistema:
python -c "import sys; print('  ', sys.executable)"
python -c "import sklearn" 2>nul
if errorlevel 1 (
  echo [Grafici] Installo scikit-learn sul Python di sistema...
  python -m pip install scikit-learn
)
set PYTHONUNBUFFERED=1
if /I "%~1"=="rapido" (
  set GRAFICI_FAST=1
  echo [Grafici] Modalita rapida: GRAFICI_FAST=1, senza --refresh
  python -u launch_grafici_sheet.py %*
) else (
  python -u launch_grafici_sheet.py --refresh %*
)
if errorlevel 1 pause
exit /b %ERRORLEVEL%
