@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Manca la venv: creare .venv e installare le dipendenze.
    exit /b 1
)
".venv\Scripts\python.exe" "data_orchestrator.py" %*
