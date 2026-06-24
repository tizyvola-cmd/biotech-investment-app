@echo off
REM NON eseguire con python. Usa:  scripts\Avvia_Grafici_Sheet.bat --refresh
REM Veloce:  scripts\Avvia_Grafici_Sheet_Rapido.bat
cd /d "%~dp0.."
call "%~dp0_grafici_pick_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
echo [Grafici] Python: %GRAFICI_PY%
"%GRAFICI_PY%" -c "import sklearn" 2>nul
if errorlevel 1 (
  echo [Grafici] sklearn non trovato - tentativo pip install...
  "%GRAFICI_PY%" -m pip install scikit-learn
  if errorlevel 1 (
    echo [Grafici] AVVISO: pip fallito ^(Accesso negato / venv bloccato^).
    echo   Se hai gia sklearn nel Python di sistema, ignora e continuo...
  )
  "%GRAFICI_PY%" -c "import sklearn" 2>nul
  if errorlevel 1 (
    echo [Grafici] ERRORE: sklearn richiesto. Prova:
    echo   python -m pip install scikit-learn
    pause
    exit /b 1
  )
)
set PYTHONUNBUFFERED=1
"%GRAFICI_PY%" -u launch_grafici_sheet.py --refresh %*
if errorlevel 1 (
  echo.
  echo Comando diretto:  python launch_grafici_sheet.py --refresh
  pause
  exit /b 1
)
exit /b 0
