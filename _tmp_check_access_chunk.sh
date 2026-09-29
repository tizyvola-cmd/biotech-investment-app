#!/bin/bash
echo "=== Access assets ==="
ls /opt/biotech/desktop-ui/dist/assets/ | grep -i Access || echo "(none — good, no separate Access chunk)"
echo "=== index js ==="
ls /opt/biotech/desktop-ui/dist/assets/index-*.js
echo "=== lazy Access string? ==="
python3 - <<'PY'
from pathlib import Path
for p in Path("/opt/biotech/desktop-ui/dist/assets").glob("index-*.js"):
    t=p.read_text(errors="ignore")
    print(p.name, "bytes", p.stat().st_size)
    print("  AccessDeskView refs:", t.count("AccessDeskView"))
    print("  AccessDeskView- hashed import:", "AccessDeskView-" in t)
PY
