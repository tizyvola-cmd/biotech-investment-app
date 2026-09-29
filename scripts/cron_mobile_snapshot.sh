#!/bin/bash
# Rebuild mobile dashboard snapshot on the VPS without desktop open.
# Installed as cron: every 15 minutes.
set -euo pipefail
cd /opt/biotech
export PATH="/usr/local/bin:/usr/bin:$PATH"
if [[ -x /opt/biotech/.venv/bin/python ]]; then
  PY=/opt/biotech/.venv/bin/python
else
  PY=python3
fi
"$PY" - <<'PY'
from scripts.mobile_dashboard_snapshot_refresh import refresh_mobile_dashboard_snapshot
summary = refresh_mobile_dashboard_snapshot(quiet=True)
print(summary)
PY
