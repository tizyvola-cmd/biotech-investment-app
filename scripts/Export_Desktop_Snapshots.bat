@echo off
cd /d "%~dp0.."
echo Esporta snapshot JSON in data\ per la UI desktop.
echo Passi: Simulation, grafici, Clinical, SEC K-8, Accuracy, Financial.
echo SEC K-8 puo richiedere 1-2 min sul workbook grande — attendere.
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -c "from excel_sheet_reader import export_desktop_snapshots; export_desktop_snapshots()"
) else (
  py -3 -c "from excel_sheet_reader import export_desktop_snapshots; export_desktop_snapshots()"
)
pause
