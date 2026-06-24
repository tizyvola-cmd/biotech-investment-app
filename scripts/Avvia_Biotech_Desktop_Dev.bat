@echo off
setlocal
cd /d "%~dp0.."
title SuperNova — Dev Electron + Vite

echo Dev a due finestre:
echo   1^) Questo script avvia Electron ^(API Python inclusa^) su http://127.0.0.1:5173
echo   2^) In un altro terminale:  cd desktop-ui ^&^& npm run dev
echo.
echo Avvio Electron in 5 secondi — apri Vite subito nell'altro terminale.
timeout /t 5 /nobreak >nul

cd electron
if not exist "node_modules\electron" call npm install
set ELECTRON_DEV=1
call npx electron main-modern.cjs
pause
