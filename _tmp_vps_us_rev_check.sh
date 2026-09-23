#!/bin/bash
ls -la /opt/biotech/us_product_revenue_lookup.py
grep -n "_SCHEMA\|moa_target\|modality" /opt/biotech/us_product_revenue_lookup.py | head -25
echo ---HTML---
grep -oE "assets/index-[^\"]+" /opt/biotech/desktop-ui/dist/index.html
echo ---JS---
ls -lt /opt/biotech/desktop-ui/dist/assets/index-*.js | head -2
JS=$(ls /opt/biotech/desktop-ui/dist/assets/index-*.js | head -1)
python3 -c "import pathlib,sys; t=pathlib.Path(sys.argv[1]).read_text(errors='ignore');
keys=['moa_target','MoA / target','Prevalenza USA','USA prevalence','Indication · USA prevalence','Indication · prevalenza'];
print({k:t.count(k) for k in keys})" "$JS"
echo ---CACHE---
python3 <<'PY'
import json
from pathlib import Path
p=Path("/opt/biotech/data/us_product_revenue_ai_cache.json")
d=json.loads(p.read_text()) if p.is_file() else {}
entries=d.get("entries") or {}
print("keys", list(entries.keys()))
for k,v in entries.items():
    if not isinstance(v, dict):
        continue
    prods=v.get("products") or []
    p0=prods[0] if prods and isinstance(prods[0], dict) else {}
    print(k, "schema=", v.get("schema"), "n=", len(prods), "fields=", sorted(p0.keys()))
PY
echo ---HEALTH---
curl -s -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:8765/api/health
systemctl is-active supernova-web