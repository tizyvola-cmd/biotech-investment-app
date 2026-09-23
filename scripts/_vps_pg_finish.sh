#!/bin/bash
set -euo pipefail
kill $(pgrep -f 'sn_pg_finish|supernova_pg as pg') 2>/dev/null || true
cd /opt/biotech
ENV=/opt/biotech/config/profiles/desktop_web_host.env
DBURL=$(grep -E '^SUPERNOVA_DATABASE_URL=' "$ENV" | tail -1 | cut -d= -f2-)
echo "pass_len=$(echo -n "$DBURL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' | wc -c)"
echo "host_part=$(echo "$DBURL" | sed -n 's|.*@\([^/]*\)/.*|\1|p')"

export PGPASSWORD=$(echo -n "$DBURL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
psql -h 127.0.0.1 -U supernova -d supernova -c 'SELECT 1 AS ok;' 

export SUPERNOVA_DATABASE_URL="$DBURL"
timeout 15 /opt/biotech/.venv/bin/python - <<'PY'
import os
from psycopg import connect
url = os.environ["SUPERNOVA_DATABASE_URL"]
print("connecting", url.split("@")[-1])
with connect(url, connect_timeout=5) as c:
    with c.cursor() as cur:
        cur.execute("SELECT 1")
        print("row", cur.fetchone())
print("direct connect ok")
import supernova_pg as pg
print(pg.healthcheck())
pg.ensure_schema()
print("schema ok")
PY

/opt/biotech/.venv/bin/python /opt/biotech/scripts/migrate_testers_to_postgres.py
/opt/biotech/.venv/bin/python /opt/biotech/scripts/publish_cdn_snapshots.py
systemctl restart supernova-web
sleep 4
systemctl is-active supernova-web
curl -sS http://127.0.0.1:8765/api/health; echo
curl -sSI http://127.0.0.1:8765/project-data/desktop_data_manifest.json | tr -d '\r' | grep -iE 'HTTP/|cache-control|content-type' || true
echo '---procs---'
ps aux | grep -E '[g]unicorn|[u]vicorn|supernova_api' | grep -v grep | head -20
echo '---journal---'
journalctl -u supernova-web -n 40 --no-pager
