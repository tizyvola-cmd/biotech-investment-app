@echo off
cd /d "%~dp0.."
echo Genera data\investment_decision_cohort.json per Decision Lab.
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe scripts\investment_decision_cohort.py
) else (
  py -3 scripts\investment_decision_cohort.py
)
pause
