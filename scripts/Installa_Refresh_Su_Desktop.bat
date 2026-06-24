@echo off
title Installa SuperNova sul Desktop
cd /d "%~dp0.."
echo.
echo ========================================
echo  SuperNova - collegamento Desktop
echo ========================================
echo.
echo Creazione collegamento...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create_Desktop_Refresh_Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo ERRORE. Prova da PowerShell:
  echo   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  echo   .\scripts\Create_Desktop_Refresh_Shortcut.ps1
  pause
  exit /b 1
)
echo.
echo ========================================
echo  FINE INSTALLAZIONE
echo ========================================
echo.
echo La finestra si chiude dopo un tasto: e' normale.
echo L'app NON si apre ora - vai sul DESKTOP e fai doppio clic su:
echo   "SuperNova"
echo (icona blu SuperNova; apre l'app unificata con tab Refresh)
echo.
pause
