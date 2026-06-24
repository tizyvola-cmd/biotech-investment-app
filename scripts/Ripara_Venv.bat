@echo off
REM Rimuove .venv bloccato/corrotto e ne crea uno nuovo.
REM Chiudi Cursor/Excel/terminali che usano il progetto prima di eseguire.
cd /d "%~dp0.."
echo.
echo [Venv] Chiudi Cursor su questo progetto e tutti i terminali Python.
echo        Premi un tasto quando hai chiuso tutto...
pause >nul
echo.
where python >nul 2>&1
if errorlevel 1 (
  echo ERRORE: python non nel PATH.
  pause
  exit /b 1
)
if exist ".venv" (
  echo [Venv] Rinomino .venv in .venv_old_%RANDOM% ...
  ren ".venv" ".venv_old_%RANDOM%" 2>nul
  if exist ".venv" (
    echo [Venv] Rinomina fallita - provo rimozione forzata...
    rmdir /s /q ".venv" 2>nul
  )
)
if exist ".venv" (
  echo.
  echo ERRORE: impossibile eliminare .venv - Accesso negato.
  echo   1. Chiudi completamente Cursor
  echo   2. Task Manager: termina python.exe legati a questo progetto
  echo   3. Riprova questo script
  echo.
  echo Nel frattempo usa Grafici SENZA venv:
  echo   Avvia_Grafici_Sistema.bat
  echo   oppure:  python launch_grafici_sheet.py --refresh
  pause
  exit /b 1
)
echo [Venv] Creo nuovo ambiente virtuale...
python -m venv .venv
if errorlevel 1 (
  echo Creazione venv fallita.
  pause
  exit /b 1
)
echo [Venv] Installo dipendenze ^(requirements-core.txt^)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if exist "requirements-core.txt" (
  ".venv\Scripts\python.exe" -m pip install -r requirements-core.txt
) else if exist "requirements.txt" (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
) else (
  ".venv\Scripts\python.exe" -m pip install openpyxl pandas numpy scikit-learn yfinance
)
".venv\Scripts\python.exe" -c "import openpyxl, sklearn; print('Venv OK')"
echo.
echo [Venv] Riparazione completata.
pause
