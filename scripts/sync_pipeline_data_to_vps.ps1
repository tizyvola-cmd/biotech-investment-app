# Sync selected data/ artifacts local -> VPS (deploy excludes data/ by design).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\sync_pipeline_data_to_vps.ps1

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$RemoteDir = "/opt/biotech/data",
    [switch]$SkipWorkbook
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $Root "data"

$Files = @(
    "medtech_symbols.json",
    "medtech_symbols_snapshot.json",
    "medtech_universe_gap_report.json",
    "biotech_symbols.json",
    "simulation_sheet_snapshot.json",
    "clinical_simulation_snapshot.json",
    "simulation_cd_scan_status.json",
    "simulation_charts_snapshot.json",
    "yf.json"
)

if (-not $SkipWorkbook) {
    $Files += "biotech_orchestrated_output.xlsx"
}

Write-Host "[sync-data] VPS -> $RemoteDir" -ForegroundColor Cyan
ssh $SshHost "mkdir -p '$RemoteDir' '$RemoteDir/logs'"

$synced = 0
foreach ($f in $Files) {
    $local = Join-Path $Data $f
    if (-not (Test-Path $local)) {
        Write-Host "  skip (missing): $f" -ForegroundColor DarkYellow
        continue
    }
    $size = (Get-Item $local).Length
    Write-Host "  upload: $f ($([math]::Round($size/1MB, 2)) MB)"
    scp $local "${SshHost}:${RemoteDir}/$f"
    $synced++
}

Write-Host "[sync-data] $synced file(s) uploaded" -ForegroundColor Green
Write-Host "[sync-data] restart supernova-web ..."
ssh $SshHost "systemctl restart supernova-web && sleep 2 && systemctl is-active supernova-web && curl -s -m 5 -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:8765/api/health"
