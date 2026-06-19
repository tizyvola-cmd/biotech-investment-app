# Build SuperNova Short per hosting v3 (stesso origin API)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $root "mobile-ui")
if (-not (Test-Path "node_modules")) {
  npm install
}
$env:VITE_API_BASE = ""
npm run build
Write-Host ""
Write-Host "OK: mobile-ui/dist pronto. Avvia host con scripts/Avvia_V3_Host.bat o vedi docs/DEPLOY_V3.md"
