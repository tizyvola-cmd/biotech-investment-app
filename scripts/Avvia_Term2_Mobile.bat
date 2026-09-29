@echo off
setlocal
title Term 2 = Mobile DEV (solo sviluppo)
cd /d "%~dp0.."
echo.
echo  ========================================
echo   ATTENZIONE: MODALITA SVILUPPO (DEV)
echo  ========================================
echo.
echo  Questa finestra serve SOLO a sviluppare l'app.
echo  Per il telefono usa invece (nessun terminale sul PC):
echo.
echo    http://91.99.15.48:8765/mobile/
echo.
echo  Oppure doppio clic: scripts\Apri_Mobile_VPS.bat
echo  Icona Desktop: scripts\Installa_Mobile_VPS_Su_Desktop.bat
echo.
echo  ========================================
echo   Term 2 = Mobile DEV - porta 5174
echo  ========================================
echo.
cd mobile-ui
if not exist node_modules (
  echo npm install...
  call npm install
)
call npm run dev
