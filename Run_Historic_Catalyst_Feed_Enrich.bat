@echo off
setlocal
cd /d "%~dp0"
echo Historic Catalyst Feed enrich (past_pred EIS backfill)...
python historic_catalyst_feed_enrich.py %*
echo.
pause
