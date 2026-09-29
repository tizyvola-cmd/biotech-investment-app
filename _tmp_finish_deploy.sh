#!/bin/bash
set -euo pipefail
cd /opt/biotech
for f in ai_user_budget.py tester_pg_io.py tester_feedback_io.py supernova_api.py mobile_snapshot_io.py quotes_batch_cache.py scripts/mobile_dashboard_snapshot_refresh.py scripts/pg_backup_supernova.py; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done
# Split legacy snapshot now
/opt/biotech/.venv/bin/python - <<'PY'
import mobile_snapshot_io as msi
print(msi.ensure_split_on_disk())
from pathlib import Path
for p in [msi.SNAPSHOT_PATH, msi.CURVE_CHARTS_PATH]:
    print(p.name, p.stat().st_size if p.is_file() else 'missing')
PY
systemctl restart supernova-web
sleep 4
systemctl is-active supernova-web
BASE=http://127.0.0.1:8765
curl -s -D /tmp/h.txt -o /tmp/slim.json -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot" >/dev/null
echo "snap_http=$(tr -d '\r' </tmp/h.txt | awk 'NR==1{print $2}') bytes=$(wc -c </tmp/slim.json | tr -d ' ')"
ETAG=$(tr -d '\r' </tmp/h.txt | awk 'tolower($1)=="etag:"{print $2; exit}')
echo "etag=$ETAG"
echo "304=$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot")"
# quotes batch
curl -s -X POST -H 'Content-Type: application/json' -d '{"tickers":["MRNA","BIIB","PFE"]}' "$BASE/api/quotes/batch" | /opt/biotech/.venv/bin/python -c 'import sys,json; d=json.load(sys.stdin); print("quotes",list(d.get("quotes",{})), "meta",d.get("meta"))'
# pg backup
/opt/biotech/.venv/bin/python /opt/biotech/scripts/pg_backup_supernova.py || true
ls -lah /opt/biotech/data/backups 2>/dev/null | tail -5 || true
