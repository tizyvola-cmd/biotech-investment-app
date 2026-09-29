# Aggiorna codice + UI sul VPS (91.99.15.48) senza sovrascrivere data/ sul server.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\deploy_vps_update.ps1
# Opzionale: -SkipBuild se dist/ e gia aggiornato

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$RemoteDir = "/opt/biotech",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
# Vite/npm write progress to stderr; do not treat that as a terminating error (PS 5.1).
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $SkipBuild) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & "$PSScriptRoot\build_desktop_web.ps1"
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "[deploy] build_desktop_web.ps1 failed (exit $LASTEXITCODE)"
    }
    $py = Join-Path $Root ".venv\Scripts\python.exe"
    if (-not (Test-Path $py)) { $py = "py" }
    & $py (Join-Path $PSScriptRoot "gen_mobile_pwa_icons.py")
    & "$PSScriptRoot\build_mobile_vps.ps1"
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "[deploy] build_mobile_vps.ps1 failed (exit $LASTEXITCODE)"
    }
    $ErrorActionPreference = $prevEap
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

# Always ship the *web* dist to VPS. Electron bake (VITE_API_BASE=127.0.0.1)
# must never be uploaded — it makes the browser show «API offline».
$webIndex = Join-Path $Root "desktop-ui\dist\index.html"
if (-not (Test-Path $webIndex)) {
    throw "[deploy] Missing desktop-ui/dist/index.html - run without -SkipBuild"
}
$indexHtml = Get-Content -Raw $webIndex
if ($indexHtml -notlike '*src="/assets/*') {
    Write-Host "[deploy] dist looks like Electron (relative ./assets) - rebuilding web ..." -ForegroundColor Yellow
    & "$PSScriptRoot\build_desktop_web.ps1"
    $indexHtml = Get-Content -Raw $webIndex
    if ($indexHtml -notlike '*src="/assets/*') {
        throw "[deploy] desktop-ui/dist is still not a web build"
    }
}

Write-Host "[deploy] Sync desktop-ui/dist (purge stale hashed assets first) ..." -ForegroundColor Cyan
ssh $SshHost 'rm -rf /opt/biotech/desktop-ui/dist/assets; mkdir -p /opt/biotech/desktop-ui/dist/assets'
scp -r (Join-Path $Root "desktop-ui\dist\*") "${SshHost}:/opt/biotech/desktop-ui/dist/"

Write-Host "[deploy] Sync mobile-ui/dist -> /mobile/ (purge stale assets first) ..." -ForegroundColor Cyan
ssh $SshHost 'rm -rf /opt/biotech/mobile-ui/dist/assets; mkdir -p /opt/biotech/mobile-ui/dist/assets /opt/biotech/mobile-ui/dist'
scp -r (Join-Path $Root "mobile-ui\dist\*") "${SshHost}:/opt/biotech/mobile-ui/dist/"

Write-Host "[deploy] Warm API workers (avoid 30s cold /api/health after restart) ..." -ForegroundColor Cyan
ssh $SshHost 'for i in 1 2 3; do curl -s -o /dev/null -m 60 http://127.0.0.1:8765/api/health; done; curl -s -o /dev/null -w "health_warm:%{time_total}s\n" http://127.0.0.1:8765/api/health'

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
Write-Host "  Push:    SUPERNOVA_VAPID_PUBLIC/PRIVATE/SUBJECT + pywebpush (HTTPS recommended)" -ForegroundColor DarkCyan
