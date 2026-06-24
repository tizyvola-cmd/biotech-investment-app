@echo off
setlocal
cd /d "%~dp0.."
title SuperNova — Refresh (legacy Tk)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -u refresh_desktop_app.py
) else (
  py -3 -u refresh_desktop_app.py
)
if errorlevel 1 pause
endlocal
