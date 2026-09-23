#!/bin/bash
set -euo pipefail
systemctl restart supernova-web
sleep 5
systemctl is-active supernova-web
BASE=http://127.0.0.1:8765
curl -s -D /tmp/h.txt -o /tmp/slim.json -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot" >/dev/null
echo "snap_bytes=$(wc -c </tmp/slim.json | tr -d ' ')"
head -15 /tmp/h.txt | tr -d '\r'
ETAG=$(awk 'BEGIN{IGNORECASE=1} /^etag:/{print $2; exit}' /tmp/h.txt | tr -d '\r')
echo "304=$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot")"
curl -s -X POST -H 'Content-Type: application/json' -d '{"tickers":["MRNA","BIIB","PFE"]}' "$BASE/api/quotes/batch" > /tmp/q.json
/opt/biotech/.venv/bin/python -c "import json;d=json.load(open('/tmp/q.json'));print('quotes',sorted(d.get('quotes',{})));print('meta',d.get('meta'))"
KEY=$(/opt/biotech/.venv/bin/python -c "import json;d=json.load(open('/opt/biotech/data/mobile_curve_charts.json'));print(next(iter(d.get('curveChartsByKey') or {}),' '))")
echo "sample_key=$KEY"
curl -s -o /dev/null -w "curve_one=%{http_code} bytes=%{size_download}\n" "$BASE/api/mobile/curve-charts?key=$(python3 -c "import urllib.parse;print(urllib.parse.quote('''$KEY'''))")"
/opt/biotech/.venv/bin/python /opt/biotech/scripts/pg_backup_supernova.py
ls -lah /opt/biotech/data/backups | tail -5
ls -lah /opt/biotech/data/mobile_dashboard_snapshot.json /opt/biotech/data/mobile_curve_charts.json
