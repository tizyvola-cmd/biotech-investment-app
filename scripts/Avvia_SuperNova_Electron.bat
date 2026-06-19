@echo off
cd /d "%~dp0.."
if not exist ".venv\Scripts\python.exe" (
  echo Crea il venv e installa dipendenze prima.
  pause
  exit /b 1
)
echo [1/2] Dipendenze API...
".venv\Scripts\python.exe" -m pip install -q -r requirements-electron.txt
echo [2/2] Electron...
cd electron
if not exist "node_modules\electron" (
  call npm install
)
call npm start
