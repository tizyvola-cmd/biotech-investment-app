# Ritorna STALE se desktop-ui va ricompilata per Electron, altrimenti FRESH.
# Usato da Avvia_Biotech_Desktop.bat (evita $variabili PowerShell mangiate da cmd.exe).
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "SilentlyContinue"
$distIndex = Join-Path $ProjectRoot "desktop-ui\dist\index.html"
if (-not (Test-Path -LiteralPath $distIndex)) {
    Write-Output "STALE"
    exit 0
}

$distHtml = Get-Content -LiteralPath $distIndex -Raw
# Electron richiede path relativi (base ./). build normale usa /assets/.
if ($distHtml -match 'src="/assets/' -or $distHtml -match 'href="/assets/') {
    Write-Output "STALE"
    exit 0
}
if ($distHtml -notmatch '\./assets/') {
    Write-Output "STALE"
    exit 0
}

$distTime = (Get-Item -LiteralPath $distIndex).LastWriteTime
$watchRoots = @(
    (Join-Path $ProjectRoot "desktop-ui\src"),
    (Join-Path $ProjectRoot "desktop-ui\index.html"),
    (Join-Path $ProjectRoot "desktop-ui\vite.config.ts"),
    (Join-Path $ProjectRoot "desktop-ui\tsconfig.json"),
    (Join-Path $ProjectRoot "desktop-ui\tailwind.config.js"),
    (Join-Path $ProjectRoot "desktop-ui\postcss.config.js"),
    (Join-Path $ProjectRoot "desktop-ui\package.json")
)
$extensions = @(".ts", ".tsx", ".css", ".html", ".js", ".json")

$latest = $null
foreach ($root in $watchRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    if ((Get-Item -LiteralPath $root).PSIsContainer -eq $false) {
        $items = @(Get-Item -LiteralPath $root)
    } else {
        $items = Get-ChildItem -LiteralPath $root -Recurse -File |
            Where-Object { $extensions -contains $_.Extension.ToLower() }
    }
    foreach ($f in $items) {
        if (-not $latest -or $f.LastWriteTime -gt $latest.LastWriteTime) {
            $latest = $f
        }
    }
}

if ($latest -and $latest.LastWriteTime -gt $distTime) {
    Write-Output "STALE"
} else {
    Write-Output "FRESH"
}
