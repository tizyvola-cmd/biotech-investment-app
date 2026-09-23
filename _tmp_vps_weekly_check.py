#!/usr/bin/env python3
import json, urllib.request
from pathlib import Path
print(Path("/opt/biotech/data/guidance_calendar_weekly_marker.json").read_text())
with urllib.request.urlopen("http://127.0.0.1:8765/api/guidance-calendar/status") as r:
    d = json.load(r)
print({k: d.get(k) for k in ("running", "last_weekly_week", "last_weekly_at", "finished_at", "message")})
print("index", [x for x in Path("/opt/biotech/desktop-ui/dist/index.html").read_text().split('"') if "index-" in x and x.endswith(".js")])
