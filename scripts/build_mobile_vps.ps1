# Build SuperNova Mobile per VPS (path /mobile/ sullo stesso host del desktop)
#
# Web Push (lock-screen Soft BUY/SELL) — on the VPS after deploy:
#   pip install pywebpush
#   python -c "from py_vapid import Vapid01; v=Vapid01(); v.generate_keys(); print(v.public_key.decode() if hasattr(v.public_key,'decode') else v.public_key); print(v.private_key)"
#   # or: npx web-push generate-vapid-keys
#   export SUPERNOVA_VAPID_PUBLIC=... SUPERNOVA_VAPID_PRIVATE=... SUPERNOVA_VAPID_SUBJECT=mailto:you@example.com
#   restart uvicorn / supernova_api
# Service worker is copied from mobile-ui/public/sw.js -> dist/sw.js (scope /mobile/).
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "py" }
& $py (Join-Path $PSScriptRoot "gen_mobile_pwa_icons.py")
Set-Location (Join-Path $root "mobile-ui")
if (-not (Test-Path "node_modules")) {
  $ErrorActionPreference = "Continue"
  npm install
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "npm install failed" }
  $ErrorActionPreference = "Stop"
}
$env:VITE_API_BASE = ""
$env:VITE_MOBILE_BASE = "/mobile"
$ErrorActionPreference = "Continue"
npm run build
$buildExit = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($buildExit -and $buildExit -ne 0) { throw "mobile npm run build failed (exit $buildExit)" }

$index = Join-Path (Get-Location) "dist\index.html"
if (-not (Test-Path $index)) {
  throw "mobile-ui/dist/index.html missing after build"
}
$indexRaw = Get-Content $index -Raw
if ($indexRaw -notmatch '/mobile/assets/') {
  throw "Build missing /mobile/ base: index.html has no /mobile/assets/ paths. Check VITE_MOBILE_BASE."
}

$manifest = Join-Path (Get-Location) "dist\manifest.webmanifest"
if (Test-Path $manifest) {
  $raw = Get-Content $manifest -Raw
  $raw = $raw -replace '"start_url"\s*:\s*"/"', '"start_url": "/mobile/"'
  $raw = $raw -replace '"scope"\s*:\s*"/"', '"scope": "/mobile/"'
  $raw = $raw -replace '"/pwa-', '"/mobile/pwa-'
  Set-Content -Path $manifest -Value $raw -NoNewline
}

$sw = Join-Path (Get-Location) "dist\sw.js"
if (-not (Test-Path $sw)) {
  throw "mobile-ui/dist/sw.js missing - public/sw.js must be copied by Vite for Web Push."
}

Write-Host ""
Write-Host "OK: mobile-ui/dist pronto per http://HOST:8765/mobile/" -ForegroundColor Green
Write-Host "Web Push: set SUPERNOVA_VAPID_* on VPS + pip install pywebpush (see script header)." -ForegroundColor Cyan
