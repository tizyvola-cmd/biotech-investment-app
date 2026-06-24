@echo off
REM SuperNova — Dear PyGui (sostituisce la versione Tkinter)
cd /d "%~dp0.."
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "supernova_dpg.py"
) else (
  echo Installa il venv e: pip install dearpygui openpyxl
  pause
)
