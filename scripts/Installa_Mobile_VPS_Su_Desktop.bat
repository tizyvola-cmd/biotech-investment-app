@echo off
rem Collegamento Desktop -> SuperNova Mobile sul VPS (no npm run dev)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create_Mobile_VPS_Shortcut.ps1"
pause
