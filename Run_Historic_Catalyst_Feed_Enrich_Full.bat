@echo off
setlocal
cd /d "%~dp0"
echo Historic Catalyst Feed — batch completo + rebuild calibration...
python historic_catalyst_feed_enrich.py --rebuild-calibration
echo.
pause
