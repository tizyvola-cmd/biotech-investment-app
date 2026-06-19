@echo off
REM Avvio desktop SuperNova (nome precedente: orchestrator launcher)
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  start "" ".venv\Scripts\pythonw.exe" "supernova_dpg.py"
) else (
  echo Installa il venv nella cartella progetto prima di avviare.
  pause
)
