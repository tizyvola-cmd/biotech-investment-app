# Build desktop UI for web host (same-origin API + /project-data/)
# Output: desktop-ui/dist/

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$Root = Split-Path -Parent $PSScriptRoot
$Ui = Join-Path $Root "desktop-ui"

Push-Location $Ui
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "[build] npm install …" -ForegroundColor Cyan
        $ErrorActionPreference = "Continue"
        npm install
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "npm install failed" }
        $ErrorActionPreference = "Stop"
    }
    $env:VITE_API_BASE = ""
    Remove-Item Env:VITE_ELECTRON -ErrorAction SilentlyContinue
    Write-Host "[build] npm run build (web / same-origin) …" -ForegroundColor Cyan
    $ErrorActionPreference = "Continue"
    npm run build
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($buildExit -and $buildExit -ne 0) {
        throw "npm run build failed (exit $buildExit)"
    }
    $index = Join-Path $Ui "dist\index.html"
    if (-not (Test-Path $index)) {
        throw "Build fallita: $index assente"
    }
    Write-Host "[build] OK → $index" -ForegroundColor Green
    Write-Host "Avvio: scripts\Avvia_Desktop_Web.bat" -ForegroundColor DarkGray
} finally {
    Pop-Location
}
