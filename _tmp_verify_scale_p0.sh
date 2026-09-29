#!/bin/bash
set -euo pipefail
sed -i 's/\r$//' /opt/biotech/ai_user_budget.py /opt/biotech/tester_pg_io.py /opt/biotech/tester_feedback_io.py /opt/biotech/supernova_api.py
systemctl restart supernova-web
sleep 4
systemctl is-active supernova-web
BASE=http://127.0.0.1:8765
curl -s -D /tmp/snap_h1.txt -o /tmp/snap1.json -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot" >/dev/null
echo "=== first GET headers ==="
tr -d '\r' < /tmp/snap_h1.txt | head -20
ETAG=$(tr -d '\r' < /tmp/snap_h1.txt | awk 'tolower($1)=="etag:"{print $2; exit}')
echo "ETAG=$ETAG"
SIZE=$(wc -c < /tmp/snap1.json | tr -d ' ')
echo "body_bytes=$SIZE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" -H 'Accept-Encoding: identity' "$BASE/api/mobile/dashboard-snapshot")
echo "second_with_etag=$CODE"
echo "anon_refresh=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/mobile/dashboard-snapshot/refresh")"
echo "anon_brief=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/market/daily-news/brief")"
echo "secrets_pd=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/project-data/ai_secrets.json")"
# Build mobile UI (quick)
if [ -d /opt/biotech/mobile-ui ]; then
  cd /opt/biotech/mobile-ui
  npm run build >/tmp/mobile_build.log 2>&1 && echo "mobile_build=ok" || { echo "mobile_build=FAIL"; tail -30 /tmp/mobile_build.log; }
fi
