#!/usr/bin/env python3
from pathlib import Path
html = Path("/opt/biotech/desktop-ui/dist/index.html").read_text(encoding="utf-8")
print("script refs:", [x for x in html.split('"') if "index-" in x and x.endswith(".js")])
js = Path("/opt/biotech/desktop-ui/dist/assets/index-DnfKMqsq.js")
t = js.read_text(encoding="utf-8", errors="ignore")
for s in ["Prossimi 6 mesi", "Finestre Q/H", "already open", "Next 6 months", "below timeline"]:
    print(s, t.count(s))
