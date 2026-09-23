#!/usr/bin/env bash
# Install Postgres + enable SuperNova multi-worker on the VPS.
# Run as root:  bash scripts/setup_vps_postgres_cdn_workers.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/biotech}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/config/profiles/desktop_web_host.env}"
DB_NAME="${SUPERNOVA_DB_NAME:-supernova}"
DB_USER="${SUPERNOVA_DB_USER:-supernova}"
WORKERS="${SUPERNOVA_WORKERS:-2}"

echo "==> apt: postgresql"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable --now postgresql

echo "==> role + database"
if grep -q '^SUPERNOVA_DATABASE_URL=' "${ENV_FILE}" 2>/dev/null; then
  echo "SUPERNOVA_DATABASE_URL already set — keeping existing credentials"
else
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
    "DO \$\$ BEGIN
       IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
         CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
       ELSE
         ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
       END IF;
     END \$\$;"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  fi
  {
    echo ""
    echo "# Postgres (tester store + sessions + sim-inputs)"
    echo "SUPERNOVA_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?sslmode=disable"
  } >> "${ENV_FILE}"
  echo "Wrote SUPERNOVA_DATABASE_URL to ${ENV_FILE}"
fi

if grep -q '^SUPERNOVA_WORKERS=' "${ENV_FILE}" 2>/dev/null; then
  sed -i "s|^SUPERNOVA_WORKERS=.*|SUPERNOVA_WORKERS=${WORKERS}|" "${ENV_FILE}"
else
  echo "SUPERNOVA_WORKERS=${WORKERS}" >> "${ENV_FILE}"
fi

echo "==> python deps"
"${APP_DIR}/.venv/bin/pip" install -q 'psycopg[binary]>=3.2' 'psycopg_pool>=3.2' 'gunicorn>=23.0' 'boto3>=1.34'

echo "==> migrate JSON → Postgres"
# Do NOT `source` the whole env file — SMTP passwords break bash.
export SUPERNOVA_DATABASE_URL="$(grep -E '^SUPERNOVA_DATABASE_URL=' "${ENV_FILE}" | tail -1 | cut -d= -f2-)"
# Local Postgres: avoid psycopg SSL negotiation hang
case "${SUPERNOVA_DATABASE_URL}" in
  *sslmode=*) ;;
  *)
    if echo "${SUPERNOVA_DATABASE_URL}" | grep -qE '127\.0\.0\.1|localhost'; then
      sep='?'; echo "${SUPERNOVA_DATABASE_URL}" | grep -q '?' && sep='&'
      SUPERNOVA_DATABASE_URL="${SUPERNOVA_DATABASE_URL}${sep}sslmode=disable"
      sed -i "s|^SUPERNOVA_DATABASE_URL=.*|SUPERNOVA_DATABASE_URL=${SUPERNOVA_DATABASE_URL}|" "${ENV_FILE}"
    fi
    ;;
esac
"${APP_DIR}/.venv/bin/python" "${APP_DIR}/scripts/migrate_testers_to_postgres.py"

echo "==> publish CDN hashed objects (local origin)"
"${APP_DIR}/.venv/bin/python" "${APP_DIR}/scripts/publish_cdn_snapshots.py" || true

echo "==> restart supernova-web"
systemctl daemon-reload
systemctl restart supernova-web
sleep 3
systemctl --no-pager --full status supernova-web | head -30

echo "==> health"
curl -sS "http://127.0.0.1:8765/api/health" || true
echo ""
curl -sS -o /dev/null -w "project-data Cache-Control: %{header_json}\n" \
  -D - "http://127.0.0.1:8765/project-data/desktop_data_manifest.json" -o /dev/null | grep -i cache-control || true
echo "Done. Put Cloudflare in front; cache /project-data/* and /cdn/o/*."
