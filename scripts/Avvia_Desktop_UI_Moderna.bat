@echo off
setlocal
cd /d "%~dp0.."
if not exist "desktop-ui\index.html" (
  echo ERRORE: desktop-ui\index.html mancante. Esegui da root o usa desktop-ui\Avvia_UI.bat
  pause
  exit /b 1
)
echo Progetto: %CD%
echo UI: http://127.0.0.1:5173/  ^(API proxy /api -^> :8765^)
echo.
echo [1/3] Verifica venv Python...
if not exist ".venv\Scripts\python.exe" (
  echo Crea .venv e installa requirements-electron.txt
  pause
  exit /b 1
)
echo [2/3] API SuperNova in finestra separata (porta 8765)...
start "SuperNova API" cmd /k ".venv\Scripts\python.exe" -m supernova_api
timeout /t 3 /nobreak >nul
echo [3/3] Desktop UI (Vite)...
cd /d "%~dp0..\desktop-ui"
if not exist "node_modules" call npm install
call npm run dev
if errorlevel 1 (
  echo.
  echo npm run dev fallito. Solo dev UI da desktop-ui:  cd desktop-ui ^&^& npm run dev
  echo NON concatenare: npm run devscripts\...  ^(usa due comandi separati^)
)
pause
