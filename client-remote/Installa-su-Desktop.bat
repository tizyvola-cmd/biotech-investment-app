@echo off
setlocal
cd /d "%~dp0"
echo.
echo  SuperNova — installazione collegamenti Desktop
echo  ==============================================
echo   1) SuperNova          = tuo account (icona colore)
echo   2) SuperNova Andrea   = account Andrea (icona grigia, profilo separato)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create-Desktop-Shortcut.ps1"
if errorlevel 1 (
  echo.
  echo ERRORE: impossibile creare i collegamenti.
  pause
  exit /b 1
)
echo.
echo Fatto. Sul Desktop trovi:
echo   - SuperNova
echo   - SuperNova Andrea  (grigia)
echo.
echo Alla prima apertura di "SuperNova Andrea" crea l'account
echo andrea.vicario1979@gmail.com  (attenzione: gmail, non gamil).
echo Sul mobile di Andrea usa la STESSA email.
echo.
pause
exit /b 0
