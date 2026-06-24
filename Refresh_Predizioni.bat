@echo off
REM ─────────────────────────────────────────────────────────────────
REM  REFRESH SEGNALI DECISION LAB
REM  Scegli la modalità:
REM    1 = Veloce (~20s) — solo slope/affid per CD imminenti
REM    2 = Completo (~5min) — aggiorna anche Excel e storico
REM ─────────────────────────────────────────────────────────────────
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo ERRORE: .venv non trovato. Esegui prima scripts\Ripara_Venv.bat
  pause
  exit /b 1
)

echo =====================================================
echo  REFRESH DECISION LAB
echo =====================================================
echo.
echo  [1] VELOCE  (~20 secondi)
echo      Aggiorna slope, affidabilita e pred per le
echo      societa con catalizzatore imminente.
echo      Da usare ogni giorno.
echo.
echo  [2] COMPLETO  (~5 minuti)
echo      Aggiorna anche Excel, storico e accuracy.
echo      Da usare 1 volta a settimana.
echo.
set /p SCELTA="Scegli [1/2]: "

if "%SCELTA%"=="1" goto VELOCE
if "%SCELTA%"=="2" goto COMPLETO
echo Scelta non valida. Uso modalita VELOCE.
goto VELOCE

:VELOCE
echo.
echo [Refresh veloce] Avvio...
".venv\Scripts\python.exe" -u refresh_live_signals.py
if errorlevel 1 (
  echo.
  echo ERRORE durante il refresh veloce.
  pause
  exit /b 1
)
echo.
echo Fatto. Ricarica la pagina nell'app per vedere i nuovi dati.
pause
exit /b 0

:COMPLETO
echo.
echo [Refresh completo] Avvio (chiudi Excel se aperto)...
".venv\Scripts\python.exe" -u launch_refresh_fast.py
if errorlevel 1 (
  echo.
  echo ERRORE durante il refresh completo.
  pause
  exit /b 1
)
echo.
echo Fatto. Ricarica la pagina nell'app per vedere i nuovi dati.
pause
exit /b 0
