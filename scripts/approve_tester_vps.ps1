# Approva un tester sul VPS (email + link installazione mobile).
# L'app Electron desktop NON può farlo — usa sempre l'API locale.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\approve_tester_vps.ps1 `
#     -TesterEmail "tizyvola@gmail.com" -ApiToken "IL_TUO_TOKEN_VPS"

param(
    [Parameter(Mandatory = $true)]
    [string]$ApiToken,
    [string]$TesterEmail = "tizyvola@gmail.com",
    [string]$VpsHost = "http://91.99.15.48:8765"
)

$tid = ($TesterEmail.Trim().ToLower() -replace "@", "_at_") -replace "[^a-z0-9._+-]", "_"
$tid = $tid.Substring(0, [Math]::Min(64, $tid.Length))

Write-Host "Approvo $TesterEmail ($tid) su $VpsHost ..." -ForegroundColor Cyan

$headers = @{
    "Content-Type"       = "application/json"
    "X-SuperNova-Token"  = $ApiToken.Trim()
}

try {
    $res = Invoke-RestMethod -Method POST `
        -Uri "$VpsHost/api/tester-feedback/testers/$tid/status" `
        -Headers $headers `
        -Body '{"status":"approved"}'

    $mail = $res.tester.approval_email
    Write-Host ""
    Write-Host "Stato: $($res.tester.status)" -ForegroundColor Green
    if ($mail.ok) {
        Write-Host "Email inviata a: $($mail.to)" -ForegroundColor Green
    } else {
        Write-Host "Email non inviata: $($mail.reason)" -ForegroundColor Yellow
        if ($mail.welcome_url) {
            Write-Host "Invia manualmente al tester:" -ForegroundColor Yellow
            Write-Host $mail.welcome_url
        }
    }
} catch {
    Write-Host "ERRORE: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    exit 1
}
