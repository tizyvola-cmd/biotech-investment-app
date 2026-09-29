#!/bin/bash
set -euo pipefail
sed -i 's/\r$//' /opt/biotech/supernova_api.py /opt/biotech/scripts/pg_backup_supernova.py
cd /opt/biotech
/opt/biotech/.venv/bin/python <<'PY'
from quotes_batch_cache import batch_quotes
print(batch_quotes(["MRNA", "BIIB", "PFE"], live_fallback=False))
PY
systemctl restart supernova-web
sleep 4
curl -s -X POST -H 'Content-Type: application/json' -d '{"tickers":["MRNA","BIIB","PFE"]}' http://127.0.0.1:8765/api/quotes/batch > /tmp/q.json
/opt/biotech/.venv/bin/python -c "import json;d=json.load(open('/tmp/q.json'));print(d)"
