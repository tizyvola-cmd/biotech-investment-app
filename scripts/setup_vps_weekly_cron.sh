#!/usr/bin/env bash
# Install cron backup for WeeklyFull on VPS (in addition to supernova_web_scheduler).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/biotech}"
PY="${APP_DIR}/.venv/bin/python"
LOG_DIR="${APP_DIR}/data/logs"
CRON_FILE="/etc/cron.d/supernova-weekly-full"

mkdir -p "${LOG_DIR}"

cat > "${CRON_FILE}" <<EOF
# SuperNova WeeklyFull — backup if in-process scheduler misses the window
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Saturday 07:15 Europe/Rome (WeeklyFull + post_refresh)
15 7 * * 6 root cd ${APP_DIR} && ${PY} -u scripts/saturday_weekly_full_refresh.py --quiet >> ${LOG_DIR}/saturday_weekly_full_cron.log 2>&1

# Sunday 02:30 — second chance if Saturday failed (no forced yfinance if marker fresh)
30 2 * * 0 root cd ${APP_DIR} && ${PY} -u scripts/saturday_weekly_full_refresh.py --force --quiet >> ${LOG_DIR}/sunday_weekly_full_cron.log 2>&1
EOF

chmod 644 "${CRON_FILE}"

# Ensure scheduler env flags are on
ENV_FILE="${APP_DIR}/config/profiles/desktop_web_host.env"
if [[ -f "${ENV_FILE}" ]]; then
  grep -q '^SUPERNOVA_SATURDAY_WEEKLY_FULL=1' "${ENV_FILE}" || echo 'SUPERNOVA_SATURDAY_WEEKLY_FULL=1' >> "${ENV_FILE}"
  grep -q '^SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME=' "${ENV_FILE}" || echo 'SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME=07:00' >> "${ENV_FILE}"
  grep -q '^SUPERNOVA_SATURDAY_WEEKLY_FULL_END=' "${ENV_FILE}" || echo 'SUPERNOVA_SATURDAY_WEEKLY_FULL_END=14:00' >> "${ENV_FILE}"
  grep -q '^SUPERNOVA_SCHEDULE_TIMEZONE=' "${ENV_FILE}" || echo 'SUPERNOVA_SCHEDULE_TIMEZONE=Europe/Rome' >> "${ENV_FILE}"
fi

systemctl restart supernova-web
sleep 2
systemctl is-active supernova-web

echo "Installed ${CRON_FILE}"
cat "${CRON_FILE}"
