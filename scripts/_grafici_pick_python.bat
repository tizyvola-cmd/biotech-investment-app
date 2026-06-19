@echo off

REM Imposta GRAFICI_PY = interprete funzionante (default: Python di sistema, NON .venv).

REM Un .venv corrotto su Windows apre "Impossibile eseguire questa app nel tuo PC".

REM Per usare .venv solo se riparato:  set USE_PROJECT_VENV=1

set "GRAFICI_PY="

set "_ROOT=%~dp0.."

if /i "%USE_PROJECT_VENV%"=="1" (

  if exist "%_ROOT%\.venv\Scripts\python.exe" (

    for %%I in ("%_ROOT%\.venv\Scripts\python.exe") do set "GRAFICI_PY=%%~fI"

  )

)

if not defined GRAFICI_PY (

  where py >nul 2>&1

  if not errorlevel 1 (

    for /f "delims=" %%P in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "GRAFICI_PY=%%P"

  )

)

if not defined GRAFICI_PY (

  where python >nul 2>&1

  if not errorlevel 1 (

    for /f "delims=" %%P in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "GRAFICI_PY=%%P"

  )

)

if not defined GRAFICI_PY (

  echo [Python] ERRORE: nessun interprete trovato (py -3 o python).

  echo   NON aprire .venv\Scripts\python.exe a mano se compare il dialogo Windows.

  echo   Da PowerShell:  python launch_refresh_sim_accuracy_grafici.py

  echo   Oppure rinomina .venv:  scripts\Disabilita_Venv_Rotto.bat

  exit /b 1

)

exit /b 0

