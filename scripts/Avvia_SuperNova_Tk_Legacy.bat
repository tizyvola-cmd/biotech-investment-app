@echo off
REM Versione Tkinter legacy (supernova_desk_tk_legacy.py)
cd /d "%~dp0.."
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" "supernova_desk_tk_legacy.py"
) else (
  echo Venv mancante.
  pause
)
