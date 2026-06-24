# Build SuperNova Mobile per connessione al VPS remoto (API split-origin)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location (Join-Path $root "mobile-ui")
if (-not (Test-Path "node_modules")) {
  npm install
}
$env:VITE_API_BASE = ""
$env:VITE_DEFAULT_REMOTE_HOST = "http://91.99.15.48:8765"
npm run build
Write-Host ""
Write-Host "OK: mobile-ui/dist pronto per VPS remoto."
Write-Host "     Hosta dist/ (nginx / sottopath) e connetti con URL $env:VITE_DEFAULT_REMOTE_HOST + token."
