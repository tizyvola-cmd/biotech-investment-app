@echo off
cd /d "%~dp0.."
echo Esporta data\financial_sheet_snapshot.json per la UI Financial (lettura rapida).
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe -c "from excel_sheet_reader import export_financial_snapshot; export_financial_snapshot()"
) else (
  py -3 -c "from excel_sheet_reader import export_financial_snapshot; export_financial_snapshot()"
)
pause
