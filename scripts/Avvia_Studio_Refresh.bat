@echo off
REM Rigenera solo il foglio Studio dalla lista «Studio watchlist» nel workbook.
REM Excel puo restare aperto: viene creato biotech_orchestrated_output__staged_*.xlsx
cd /d "%~dp0.."
python fetch_retrospective.py --studio-only
pause
