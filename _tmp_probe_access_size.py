#!/usr/bin/env python3
import json, re, subprocess, urllib.request
from pathlib import Path

out = subprocess.check_output(
    ["systemctl", "show", "supernova-web", "-p", "Environment", "--value"],
    text=True,
)
m = re.search(r"SUPERNOVA_API_TOKEN=(\S+)", out)
token = m.group(1) if m else Path("/opt/biotech/.supernova_api_token").read_text().strip()
req = urllib.request.Request(
    "http://127.0.0.1:8765/api/tester-feedback/summary",
    headers={"X-SuperNova-Token": token},
)
body = urllib.request.urlopen(req, timeout=60).read()
print("bytes", len(body))
d = json.loads(body)
print("testers", len(d.get("testers") or []))
print("pending", d.get("pending_testers"), "approved", d.get("approved_testers"))
