#!/bin/bash
set -euo pipefail
cd /opt/biotech
/opt/biotech/.venv/bin/python <<'PY'
from orchestrator_io_paths import DATA_DIR
from pathlib import Path
import os
print("DATA_DIR", DATA_DIR)
p = Path(DATA_DIR) / "desktop_data_manifest.json"
print("exists", p.is_file(), p)
print("serve_desktop", os.environ.get("SUPERNOVA_SERVE_DESKTOP"))
# list routes
from supernova_api import app
paths = []
for r in app.routes:
    pth = getattr(r, "path", None) or getattr(r, "path_format", None)
    if pth and ("project-data" in str(pth) or "cdn" in str(pth)):
        paths.append(str(pth))
print("routes", paths[:20])
PY
curl -sS "http://127.0.0.1:8765/project-data/desktop_data_manifest.json" | head -c 200; echo
curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8765/cdn/o/021c22c79e9ce2dd241bb93c3a8667519b88d73c8146e1d4433e159601f27c88.json"
# env from systemd
systemctl show supernova-web -p EnvironmentFiles -p Environment | head -20
grep SUPERNOVA_SERVE /opt/biotech/config/profiles/desktop_web_host.env
