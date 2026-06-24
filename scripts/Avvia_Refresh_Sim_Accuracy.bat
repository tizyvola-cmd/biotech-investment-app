@echo off

REM Simulation + Accuracy + Predizione guida + Grafici

REM Python: .venv se funzionante, altrimenti py -3 / python di sistema.

cd /d "%~dp0.."

call "%~dp0_grafici_pick_python.bat"

if errorlevel 1 (

  pause

  exit /b 1

)

echo [Refresh] Python: %GRAFICI_PY%

set PYTHONUNBUFFERED=1

"%GRAFICI_PY%" -u launch_refresh_sim_accuracy_grafici.py %*

if errorlevel 1 (

  echo.

  echo Comando diretto:

  echo   python launch_refresh_sim_accuracy_grafici.py

  echo Solo Grafici:

  echo   python launch_refresh_sim_accuracy_grafici.py --skip-simulation --skip-guida --skip-accuracy

  pause

  exit /b 1

)

exit /b 0

