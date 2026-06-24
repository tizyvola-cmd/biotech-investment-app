# Imposta URL pubblico mobile sul VPS (91.99.15.48) per link approvazione tester.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\configure_vps_public_host.ps1

param(
    [string]$SshHost = "root@91.99.15.48",
    [string]$EnvFile = "/opt/biotech/config/profiles/desktop_web_host.env",
    [string]$PublicHost = "91.99.15.48",
    [string]$PublicScheme = "http",
    [string]$Port = "8765"
)

$mobileUrl = "${PublicScheme}://${PublicHost}:${Port}/mobile"
Write-Host "Configuro SUPERNOVA_PUBLIC_HOST e SUPERNOVA_MOBILE_PUBLIC_URL -> $mobileUrl" -ForegroundColor Cyan

# Una riga sola (evita errori CRLF Windows su sleep/sed via SSH)
$remote = @(
    "set -e",
    "ENV='$EnvFile'",
    "grep -q '^SUPERNOVA_PUBLIC_HOST=' `"`$ENV`" 2>/dev/null && sed -i 's|^SUPERNOVA_PUBLIC_HOST=.*|SUPERNOVA_PUBLIC_HOST=$PublicHost|' `"`$ENV`" || echo 'SUPERNOVA_PUBLIC_HOST=$PublicHost' >> `"`$ENV`"",
    "grep -q '^SUPERNOVA_MOBILE_PUBLIC_URL=' `"`$ENV`" 2>/dev/null && sed -i 's|^SUPERNOVA_MOBILE_PUBLIC_URL=.*|SUPERNOVA_MOBILE_PUBLIC_URL=$mobileUrl|' `"`$ENV`" || echo 'SUPERNOVA_MOBILE_PUBLIC_URL=$mobileUrl' >> `"`$ENV`"",
    "systemctl restart supernova-web",
    "curl -s http://127.0.0.1:8765/api/tester-feedback/config | head -c 500"
) -join "; "

ssh $SshHost $remote
Write-Host ""
Write-Host "OK. Per email automatiche:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\configure_vps_smtp.ps1 -SmtpUser TUO@gmail.com -SmtpPassword 'app-password'" -ForegroundColor Yellow
