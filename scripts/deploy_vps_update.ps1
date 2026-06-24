# Aggiorna codice + UI sul VPS (91.99.15.48) senza sovrascrivere data/ sul server.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\deploy_vps_update.ps1
# Opzionale: -SkipBuild se dist/ e gia aggiornato

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$RemoteDir = "/opt/biotech",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipBuild) {
    & "$PSScriptRoot\build_desktop_web.ps1"
    $py = Join-Path $Root ".venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { $py = "py" }
    & $py (Join-Path $PSScriptRoot "gen_mobile_pwa_icons.py")
    & "$PSScriptRoot\build_mobile_vps.ps1"
}

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TarLocal = Join-Path $env:TEMP "biotech_deploy_$Stamp.tar.gz"

Write-Host "[deploy] Pacchetto codice (no data/, no .venv) ..." -ForegroundColor Cyan
tar -czf $TarLocal `
    --exclude=".venv" `
    --exclude="node_modules" `
    --exclude="data" `
    --exclude=".git" `
    --exclude="__pycache__" `
    --exclude="electron/node_modules" `
    --exclude="desktop-ui/node_modules" `
    --exclude="mobile-ui/node_modules" `
    --exclude="*.pyc" `
    --exclude=".env" `
    --exclude="config/profiles/desktop_web_host.env" `
    --exclude="config/profiles/mobile_v3_host.env" `
    -C $Root .

$RemoteTar = "/tmp/biotech_deploy_$Stamp.tar.gz"
Write-Host "[deploy] Upload -> $SshHost ..." -ForegroundColor Cyan
scp $TarLocal "${SshHost}:${RemoteTar}"

Write-Host "[deploy] Estrazione + restart supernova-web ..." -ForegroundColor Cyan
$deployCmd = "cd '$RemoteDir' && tar -xzf '$RemoteTar' && rm -f '$RemoteTar' && systemctl restart supernova-web && sleep 2 && systemctl is-active supernova-web && curl -s -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:8765/api/health"
ssh $SshHost $deployCmd

Write-Host "[deploy] Sync desktop-ui/dist (bundle + index.html) ..." -ForegroundColor Cyan
scp -r (Join-Path $Root "desktop-ui\dist\*") "${SshHost}:/opt/biotech/desktop-ui/dist/"

Write-Host "[deploy] Sync mobile-ui/dist -> /mobile/ ..." -ForegroundColor Cyan
ssh $SshHost "mkdir -p /opt/biotech/mobile-ui/dist"
scp -r (Join-Path $Root "mobile-ui\dist\*") "${SshHost}:/opt/biotech/mobile-ui/dist/"

Remove-Item $TarLocal -Force -ErrorAction SilentlyContinue
if (-not $SkipBuild) {
    Write-Host "[deploy] Ripristino desktop-ui/dist per Electron locale (build:electron) ..." -ForegroundColor Cyan
    Push-Location (Join-Path $Root "desktop-ui")
    try {
        npm run build:electron
    } finally {
        Pop-Location
    }
}
Write-Host "[deploy] OK" -ForegroundColor Green
Write-Host "  Desktop: http://91.99.15.48:8765/" -ForegroundColor Green
Write-Host "  Mobile:  http://91.99.15.48:8765/mobile/" -ForegroundColor Green
