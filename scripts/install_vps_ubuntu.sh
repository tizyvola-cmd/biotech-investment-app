#!/usr/bin/env bash
# Install SuperNova Desktop Web (Option B) on Ubuntu 22.04/24.04 VPS.
# Run as root: bash scripts/install_vps_ubuntu.sh
# If copied from Windows and you see "set: pipefail" error:
#   sed -i 's/\r$//' scripts/install_vps_ubuntu.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/biotech}"
REPO_URL="${REPO_URL:-}"
PY="${APP_DIR}/.venv/bin/python"
PIP="${APP_DIR}/.venv/bin/pip"

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  python3 python3-venv python3-pip git curl \
  build-essential libffi-dev \
  nodejs npm

echo "==> App directory ${APP_DIR}"
mkdir -p "$(dirname "${APP_DIR}")"
if [[ ! -d "${APP_DIR}/.git" && ! -f "${APP_DIR}/supernova_api.py" ]]; then
  if [[ -n "${REPO_URL}" ]]; then
    git clone "${REPO_URL}" "${APP_DIR}"
  else
    echo "Copia il progetto in ${APP_DIR} (scp da PC) oppure imposta REPO_URL=..."
    exit 1
  fi
fi
cd "${APP_DIR}"

echo "==> Python venv + deps"
python3 -m venv .venv
"${PIP}" install -q -U pip
"${PIP}" install -q -r requirements-core.txt -r requirements-electron.txt

echo "==> Desktop UI build"
if [[ ! -f desktop-ui/dist/index.html ]]; then
  pushd desktop-ui
  npm ci --silent 2>/dev/null || npm install --silent
  export VITE_API_BASE=""
  npm run build:web
  popd
fi

echo "==> Env profile"
if [[ ! -f config/profiles/desktop_web_host.env ]]; then
  echo "Manca config/profiles/desktop_web_host.env"
  exit 1
fi
ENV_FILE="${APP_DIR}/config/profiles/desktop_web_host.env"
if grep -q 'CAMBIA_QUESTA_CHIAVE' "${ENV_FILE}" 2>/dev/null; then
  TOKEN=$(openssl rand -hex 24)
  sed -i "s/SUPERNOVA_API_TOKEN=.*/SUPERNOVA_API_TOKEN=${TOKEN}/" "${ENV_FILE}"
  echo "Token API generato — salvalo:"
  grep SUPERNOVA_API_TOKEN "${ENV_FILE}"
fi

mkdir -p data data/logs

echo "==> systemd unit"
cat > /etc/systemd/system/supernova-web.service <<EOF
[Unit]
Description=SuperNova Biotech Web (API + UI)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/config/profiles/desktop_web_host.env
Environment=PYTHONUNBUFFERED=1
ExecStart=${PY} -m supernova_api
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable supernova-web
systemctl restart supernova-web

echo ""
echo "==> Done"
echo "    http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):8765/"
echo "    Logs: journalctl -u supernova-web -f"
echo "    Status: systemctl status supernova-web"
