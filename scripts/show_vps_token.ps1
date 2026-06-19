# Legge SUPERNOVA_API_TOKEN dal VPS (serve password root o chiave SSH).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\show_vps_token.ps1

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$EnvFile = "/opt/biotech/config/profiles/desktop_web_host.env"
)

Write-Host "Connessione a $SshHost ..." -ForegroundColor Cyan
Write-Host "(inserisci la password root del VPS quando richiesta)" -ForegroundColor DarkGray
Write-Host ""

$line = ssh $SshHost "grep '^SUPERNOVA_API_TOKEN=' '$EnvFile' 2>/dev/null || grep -r '^SUPERNOVA_API_TOKEN=' /opt/biotech/config/profiles 2>/dev/null | head -1"
if (-not $line) {
    Write-Host "Token non trovato su $EnvFile" -ForegroundColor Red
    exit 1
}

$value = ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
Write-Host "Token sul VPS (copia SOLO questo valore):" -ForegroundColor Green
Write-Host $value
Write-Host ""
Write-Host "Poi nell'app: menu Sistema -> tab Impostazioni -> X-SuperNova-Token -> incolla -> Salva token -> Test token" -ForegroundColor Yellow
