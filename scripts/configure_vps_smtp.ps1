# Configura SMTP sul VPS per email approvazione tester (NON sul PC — PowerShell locale).
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\configure_vps_smtp.ps1 `
#     -SmtpUser "tua@gmail.com" -SmtpPassword "xxxx xxxx xxxx xxxx"

param(
    [Parameter(Mandatory = $true)]
    [string]$SmtpUser,
    [Parameter(Mandatory = $true)]
    [string]$SmtpPassword,
    [string]$SshHost = "root@91.99.15.48",
    [string]$EnvFile = "/opt/biotech/config/profiles/desktop_web_host.env",
    [string]$SmtpHost = "smtp.gmail.com",
    [string]$SmtpPort = "587",
    [string]$From = ""
)

if (-not $From) { $From = "SuperNova <$SmtpUser>" }

Write-Host "Configuro SMTP su $SshHost ($EnvFile) ..." -ForegroundColor Cyan

function Set-EnvLine([string]$Key, [string]$Value) {
    $escaped = $Value -replace "'", "'\\''"
    return "grep -q '^${Key}=' `"`$ENV`" 2>/dev/null && sed -i 's|^${Key}=.*|${Key}=$escaped|' `"`$ENV`" || echo '${Key}=$escaped' >> `"`$ENV`""
}

$remote = @(
    "set -e",
    "ENV='$EnvFile'",
    (Set-EnvLine "SUPERNOVA_SMTP_HOST" $SmtpHost),
    (Set-EnvLine "SUPERNOVA_SMTP_PORT" $SmtpPort),
    (Set-EnvLine "SUPERNOVA_SMTP_USER" $SmtpUser),
    (Set-EnvLine "SUPERNOVA_SMTP_PASSWORD" $SmtpPassword),
    (Set-EnvLine "SUPERNOVA_SMTP_FROM" $From),
    "systemctl restart supernova-web",
    "curl -s http://127.0.0.1:8765/api/tester-feedback/config | head -c 600"
) -join "; "

ssh $SshHost $remote
Write-Host ""
Write-Host "OK. In Monitor tester dopo Approva dovresti vedere 'Email inviata a ...'" -ForegroundColor Green
