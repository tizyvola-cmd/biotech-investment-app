# Build SuperNova Mobile per VPS (path /mobile/ sullo stesso host del desktop)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "py" }
& $py (Join-Path $PSScriptRoot "gen_mobile_pwa_icons.py")
Set-Location (Join-Path $root "mobile-ui")
if (-not (Test-Path "node_modules")) {
  npm install
}
$env:VITE_API_BASE = ""
$env:VITE_MOBILE_BASE = "/mobile"
npm run build

$manifest = Join-Path (Get-Location) "dist\manifest.webmanifest"
if (Test-Path $manifest) {
  $raw = Get-Content $manifest -Raw
  $raw = $raw -replace '"start_url"\s*:\s*"/"', '"start_url": "/mobile/"'
  $raw = $raw -replace '"scope"\s*:\s*"/"', '"scope": "/mobile/"'
  $raw = $raw -replace '"/pwa-', '"/mobile/pwa-'
  Set-Content -Path $manifest -Value $raw -NoNewline
}

Write-Host ""
Write-Host "OK: mobile-ui/dist pronto per http://HOST:8765/mobile/" -ForegroundColor Green
