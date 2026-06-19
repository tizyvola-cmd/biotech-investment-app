# Backup locale PC + download snapshot dal VPS.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\backup_biotech.ps1

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$RemoteDir = "/opt/biotech",
    [string]$BackupRoot = "C:\coding\backups"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"

if (-not (Test-Path $BackupRoot)) {
    New-Item -ItemType Directory -Path $BackupRoot | Out-Null
}

# --- Backup PC (codice + data locale, no cache pesanti) ---
$PcTar = Join-Path $BackupRoot "biotech_PC_$Stamp.tar.gz"
Write-Host "[backup] PC -> $PcTar ..." -ForegroundColor Cyan
tar -czf $PcTar `
    --exclude=".venv" `
    --exclude="node_modules" `
    --exclude="data/price_cache" `
    --exclude=".git" `
    --exclude="__pycache__" `
    --exclude="electron/node_modules" `
    --exclude="desktop-ui/node_modules" `
    --exclude="mobile-ui/node_modules" `
    -C $Root .

# --- Backup VPS (data + codice sul server) ---
$RemoteTar = "/tmp/biotech_VPS_$Stamp.tar.gz"
Write-Host "[backup] VPS snapshot ..." -ForegroundColor Cyan
$tarCmd = "cd '$RemoteDir' && tar -czf '$RemoteTar' --exclude='.venv' --exclude='node_modules' --exclude='data/price_cache' --exclude='__pycache__' ."
ssh $SshHost $tarCmd

$VpsTar = Join-Path $BackupRoot "biotech_VPS_$Stamp.tar.gz"
Write-Host "[backup] Download VPS -> $VpsTar ..." -ForegroundColor Cyan
scp "${SshHost}:${RemoteTar}" $VpsTar
ssh $SshHost "rm -f '$RemoteTar'"

Write-Host ""
Write-Host "[backup] Completato:" -ForegroundColor Green
Write-Host "  PC  : $PcTar ($([math]::Round((Get-Item $PcTar).Length/1MB, 1)) MB)"
Write-Host "  VPS : $VpsTar ($([math]::Round((Get-Item $VpsTar).Length/1MB, 1)) MB)"
