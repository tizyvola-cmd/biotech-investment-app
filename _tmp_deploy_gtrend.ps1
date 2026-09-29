$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$SshHost = "root@91.99.15.48"
$Root = "c:\coding\Biotech_Investment app 6"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TarLocal = Join-Path $env:TEMP "biotech_deploy_$Stamp.tar.gz"
$RemoteTar = "/tmp/biotech_deploy_$Stamp.tar.gz"

Write-Host "[1] pack..."
tar -czf $TarLocal `
  --exclude=".venv" `
  --exclude="node_modules" `
  --exclude="data" `
  --exclude=".git" `
  --exclude="__pycache__" `
  --exclude="electron/node_modules" `
  --exclude="desktop-ui/node_modules" `
  --exclude="mobile-ui/node_modules" `
  --exclude="*.pyc" `
  --exclude=".env" `
  --exclude="config/profiles/desktop_web_host.env" `
  --exclude="config/profiles/mobile_v3_host.env" `
  -C $Root .

Write-Host "[2] scp tar..."
scp $TarLocal "${SshHost}:${RemoteTar}"

Write-Host "[3] extract+restart..."
$deployCmd = "cd /opt/biotech && tar -xzf '$RemoteTar' 2>/dev/null; rm -f '$RemoteTar'; systemctl restart supernova-web; sleep 2; systemctl is-active supernova-web; curl -s -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:8765/api/health"
ssh $SshHost $deployCmd

Write-Host "[4] sync dist..."
ssh $SshHost "rm -rf /opt/biotech/desktop-ui/dist/assets; mkdir -p /opt/biotech/desktop-ui/dist/assets"
scp -r (Join-Path $Root "desktop-ui\dist\*") "${SshHost}:/opt/biotech/desktop-ui/dist/"

Write-Host "[5] verify..."
ssh $SshHost "ls /opt/biotech/desktop-ui/dist/assets/index-*.js | head -1; head -c 200 /opt/biotech/desktop-ui/dist/index.html; echo"

Remove-Item $TarLocal -ErrorAction SilentlyContinue
Write-Host "DONE"
