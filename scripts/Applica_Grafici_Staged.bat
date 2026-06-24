@echo off

REM Copia l'ultimo biotech_orchestrated_output__grafici_staged_*.xlsx sul file principale.

REM Chiudi Excel sul workbook prima di eseguire.

cd /d "%~dp0.."

call "%~dp0_grafici_pick_python.bat"

if errorlevel 1 (

  pause

  exit /b 1

)

echo [Applica staged] Python: %GRAFICI_PY%
"%GRAFICI_PY%" -u launch_apply_grafici_staged.py

if errorlevel 1 pause

exit /b %errorlevel%

