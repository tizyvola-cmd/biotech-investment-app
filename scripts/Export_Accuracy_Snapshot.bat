@echo off
cd /d "%~dp0.."
echo Esporta data\accuracy_sheet_snapshot.json per la UI Accuracy (lettura rapida).
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -c "from excel_sheet_reader import export_accuracy_snapshot; export_accuracy_snapshot()"
) else (
  py -3 -c "from excel_sheet_reader import export_accuracy_snapshot; export_accuracy_snapshot()"
)
pause
