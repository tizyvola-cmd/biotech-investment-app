#!/usr/bin/env python3
from pathlib import Path
p = Path("/opt/biotech/desktop-ui/dist/index.html")
print(p.read_text(encoding="utf-8")[:800])
print("---")
js = list(Path("/opt/biotech/desktop-ui/dist/assets").glob("index-*.js"))
print("index js files:", [x.name for x in js])
for j in js:
    t = j.read_text(encoding="utf-8", errors="ignore")
    print(j.name, "resto del calendario", "resto del calendario" in t, "Beyond ~", "Beyond ~" in t)
