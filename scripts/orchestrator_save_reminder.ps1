# Verifica data_orchestrator.py su DISCO (non il buffer non salvato di Cursor).
$orch = "C:\coding\Biotech_Investment app 6\data_orchestrator.py"
if (-not (Test-Path -LiteralPath $orch)) {
    Write-Host "File non trovato: $orch" -ForegroundColor Red
    exit 2
}
$n = 0
$sr = [System.IO.StreamReader]::new($orch)
while ($null -ne $sr.ReadLine()) { $n++ }
$sr.Close()
$need = @(
    "regenerate_simulation_sheet_quick",
    "_run_simulation_sheet_into_workbook",
    "_write_accuracy_simulation_sheet",
    "_build_financial_df_for_orchestrator"
)
$text = [System.IO.File]::ReadAllText($orch)
Write-Host "Righe su disco: $n"
foreach ($fn in $need) {
    $ok = $text -match "(?m)^def $([regex]::Escape($fn))\b"
    Write-Host ("  {0}: {1}" -f $fn, $(if ($ok) { "OK" } else { "MANCANTE" }))
}
if ($n -lt 32000) {
    Write-Host ""
    Write-Host "Il file su disco e' TRONCATO (attese ~34000+ righe)." -ForegroundColor Yellow
    Write-Host "Se in Cursor vedi ~35000 righe: apri data_orchestrator.py e premi Ctrl+S (Salva)." -ForegroundColor Cyan
    Write-Host "Poi: py -3 scripts\check_orchestrator_health.py"
    exit 1
}
Write-Host ""
Write-Host "Dimensione plausibile. Esegui: py -3 scripts\check_orchestrator_health.py"
exit 0
