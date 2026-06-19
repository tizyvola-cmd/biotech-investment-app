@echo off

REM Uso: Run_Refresh_Profile_Silent.bat daily|accuracy|sec_k8|sunday

REM Per macro Excel / VBS (exit code = esito Python).



setlocal

set "PROFILE=%~1"

if "%PROFILE%"=="" set "PROFILE=daily"



cd /d "%~dp0.."



call "%~dp0_grafici_pick_python.bat"

if errorlevel 1 exit /b 2



set PYTHONUNBUFFERED=1



if /I "%PROFILE%"=="daily" goto :daily

if /I "%PROFILE%"=="fast" goto :daily

if /I "%PROFILE%"=="accuracy" goto :accuracy

if /I "%PROFILE%"=="sec_k8" goto :sec_k8

if /I "%PROFILE%"=="sunday" goto :sunday

if /I "%PROFILE%"=="weekly" goto :sunday



echo [Run_Refresh_Profile] Profilo sconosciuto: %PROFILE%

exit /b 2



:daily

set HISTLIB_INCREMENTAL_ONLY=1

set HISTLIB_MIN_LAG_DAYS=3

set REFRESH_K8_LIVE_FALLBACK=1

set PRED_CURVE_SEQ_CALIB=1

set SEC_K8_LOOKBACK_DAYS=180

set PRED_K8_DISPLAY_OVERLAY=1

set DAILY_REFRESH_FAST=1

set ACCURACY_REFRESH_FAST=1

set DAILY_SKIP_ACCURACY_SHEET=1

set ACC_SIM_BULK_PAST_WRITE=1

set ACCURACY_V5_RAW_METRICS=0

set PAST_CATALYST_SKIP_CLINICAL_EXTRA=1

set HISTLIB_REFRESH_ON_ENRICH=0

set SIM_PRESERVE_OUTCOMES=1

set ORCH_SKIP_LIQUIDITY_YF=1

"%GRAFICI_PY%" -u launch_refresh_fast.py %*

exit /b %ERRORLEVEL%



:accuracy

set HISTLIB_INCREMENTAL_ONLY=1

set HISTLIB_MIN_LAG_DAYS=3

set REFRESH_K8_LIVE_FALLBACK=1

set PRED_CURVE_SEQ_CALIB=1

set SEC_K8_LOOKBACK_DAYS=180

set PRED_K8_DISPLAY_OVERLAY=1

set ACCURACY_REFRESH_FAST=0

set ACC_SIM_BULK_PAST_WRITE=0

set SIM_PRESERVE_OUTCOMES=1

set ORCH_SKIP_LIQUIDITY_YF=1

"%GRAFICI_PY%" -u launch_refresh_fast.py --skip-simulation %*

exit /b %ERRORLEVEL%



:sec_k8

"%GRAFICI_PY%" -u refresh_sec_k8_sheet.py %*

exit /b %ERRORLEVEL%



:sunday

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Biotech_Refresh_Profiles.ps1" -Profile WeeklyFull

exit /b %ERRORLEVEL%

