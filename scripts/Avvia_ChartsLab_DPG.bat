@echo off
REM Grafici integrati in SuperNova (scheda Charts) — stesso eseguibile
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "supernova_dpg.py"
) else (
  pause
)
