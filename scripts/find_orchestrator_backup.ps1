# Cerca copie di data_orchestrator.py (conteggio righe).
$roots = @(
    "C:\coding",
    "$env:USERPROFILE\OneDrive\Desktop\coding",
    "$env:USERPROFILE\OneDrive",
    "$env:USERPROFILE\Downloads"
)
# Cartelle progetto tipiche (profondità limitata nel foreach sotto)
$extraDirs = @(
    "C:\coding\Biotech_Investment app 5",
    "C:\coding\Biotech_Investment app 4",
    "$env:USERPROFILE\OneDrive\Desktop\coding\Biotech_Investment app 5",
    "$env:USERPROFILE\OneDrive\Desktop\coding\Biotech_Investment app 6"
)
$projectFile = "C:\coding\Biotech_Investment app 6\data_orchestrator.py"
$hits = [System.Collections.Generic.List[object]]::new()

function Get-LineCount([string]$path) {
    try {
        $n = 0
        $sr = [System.IO.StreamReader]::new($path)
        while ($null -ne $sr.ReadLine()) { $n++ }
        $sr.Close()
        return $n
    } catch {
        return -1
    }
}

if (Test-Path -LiteralPath $projectFile) {
    $fi = Get-Item -LiteralPath $projectFile
    $hits.Add([PSCustomObject]@{
            Path  = $fi.FullName
            Lines = (Get-LineCount $fi.FullName)
            MB    = [math]::Round($fi.Length / 1MB, 2)
        })
}

foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Recurse -Filter "data_orchestrator.py" -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($hits.Path -contains $_.FullName) { return }
            $hits.Add([PSCustomObject]@{
                    Path  = $_.FullName
                    Lines = (Get-LineCount $_.FullName)
                    MB    = [math]::Round($_.Length / 1MB, 2)
                })
        }
}
foreach ($dir in $extraDirs) {
    $f = Join-Path $dir "data_orchestrator.py"
    if (-not (Test-Path -LiteralPath $f)) { continue }
    if ($hits.Path -contains (Resolve-Path -LiteralPath $f).Path) { continue }
    $fi = Get-Item -LiteralPath $f
    $hits.Add([PSCustomObject]@{
            Path  = $fi.FullName
            Lines = (Get-LineCount $fi.FullName)
            MB    = [math]::Round($fi.Length / 1MB, 2)
        })
}

$sorted = $hits | Sort-Object Lines -Descending
if (-not $sorted) {
    Write-Host "Nessun data_orchestrator.py trovato." -ForegroundColor Yellow
    exit 1
}

$sorted | Format-Table -AutoSize
$best = $sorted | Where-Object { $_.Lines -ge 32000 } | Select-Object -First 1
if ($best) {
    Write-Host ""
    Write-Host "COPIA COMPLETA PROBABILE:" -ForegroundColor Green
    Write-Host $best.Path
    Write-Host ""
    Write-Host 'Copy-Item -LiteralPath "' -NoNewline
    Write-Host $best.Path -NoNewline
    Write-Host '" -Destination "C:\coding\Biotech_Investment app 6\data_orchestrator.py" -Force'
} else {
    Write-Host ""
    Write-Host "Nessuna copia con >= 32000 righe." -ForegroundColor Yellow
    Write-Host "NON usare C:\coding\backups\data_orchestrator.py se ha MENO righe del file attuale."
    Write-Host "Prova: OneDrive cronologia, Proprieta -> Versioni precedenti, Cursor Timeline."
    Write-Host "Vedi: scripts\RESTORE_DATA_ORCHESTRATOR.md"
    Write-Host "File progetto:"
    Write-Host "  $projectFile"
    $cur = $sorted | Select-Object -First 1
    if ($cur) {
        Write-Host ""
        Write-Host "File attuale: $($cur.Lines) righe (troncato se < 32000)."
    }
}
