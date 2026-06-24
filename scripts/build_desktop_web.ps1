# Build desktop UI for web host (same-origin API + /project-data/)
# Output: desktop-ui/dist/

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Ui = Join-Path $Root "desktop-ui"

Push-Location $Ui
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "[build] npm install …" -ForegroundColor Cyan
        npm install
    }
    $env:VITE_API_BASE = ""
    Remove-Item Env:VITE_ELECTRON -ErrorAction SilentlyContinue
    Write-Host "[build] npm run build (web / same-origin) …" -ForegroundColor Cyan
    npm run build
    $index = Join-Path $Ui "dist\index.html"
    if (-not (Test-Path $index)) {
        throw "Build fallita: $index assente"
    }
    Write-Host "[build] OK → $index" -ForegroundColor Green
    Write-Host "Avvio: scripts\Avvia_Desktop_Web.bat" -ForegroundColor DarkGray
} finally {
    Pop-Location
}
