#!/bin/bash
set -e
TOKEN=""
for f in /opt/biotech/.supernova_api_token /opt/biotech/data/.supernova_api_token; do
  if [ -f "$f" ]; then TOKEN=$(cat "$f"); break; fi
done
H="Authorization: Bearer $TOKEN"
for p in /api/health /api/tester-feedback/config /api/tester-feedback/summary /api/premium-waitlist /api/contact /api/refresh/status; do
  echo "=== $p ==="
  curl -s -o /tmp/sn_t.json -w "http:%{http_code} time:%{time_total}s size:%{size_download}\n" -H "$H" "http://127.0.0.1:8765$p" || echo "curl fail"
  python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/sn_t.json"))
  if isinstance(d, dict):
    keys=sorted(d)[:12]
    print("keys:", keys)
    if "testers" in d: print("testers:", len(d.get("testers") or []))
    if "events_total" in d: print("events_total:", d.get("events_total"))
    if "state" in d: print("state:", d.get("state"), "running:", d.get("running"))
    if "entries" in d: print("entries:", len(d.get("entries") or []))
  else:
    print(type(d))
except Exception as e:
  print("parse err", e)
  print(open("/tmp/sn_t.json").read()[:200])
PY
  echo
done
# also check if refresh_fast / orchestrator processes are running
echo "=== processes ==="
ps aux | grep -E 'refresh_fast|data_orchestrator|orchestrator' | grep -v grep | head -20 || true
echo "=== load ==="
uptime
