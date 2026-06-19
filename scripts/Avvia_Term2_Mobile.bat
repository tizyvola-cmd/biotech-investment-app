@echo off
setlocal
title Term 2 = Mobile (PWA 5174)
cd /d "%~dp0.."
echo.
echo  ========================================
echo   Term 2 = Mobile
echo  SuperNova Mobile - porta 5174
echo  Tab: Dashboard · Portfolio · Opportunities
echo  ========================================
echo.
echo  Prima avvia Term 1 = Biotech (API 8765).
echo  Se vedi "Port 5174 already in use" = Mobile gia attivo: usa la finestra vecchia.
echo.
echo  Server online: URL API = http://91.99.15.48:8765 + token VPS
echo  Per icona sul Desktop: scripts\Installa_Mobile_Su_Desktop.bat
echo.
cd mobile-ui
if not exist node_modules (
  echo npm install...
  call npm install
)
call npm run dev
