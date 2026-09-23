#!/usr/bin/env python3
import json, os, re, subprocess, urllib.request
from pathlib import Path

os.chdir("/opt/biotech")
import sys
sys.path.insert(0, "/opt/biotech")
import tester_feedback_io as tf

print("module_STORE", tf.STORE_PATH)
print("exists", tf.STORE_PATH.is_file(), "size", tf.STORE_PATH.stat().st_size if tf.STORE_PATH.is_file() else None)
s = tf.build_summary()
print("direct_n", len(s.get("testers") or []), "pending", s.get("pending_testers"), "approved", s.get("approved_testers"))
for t in s.get("testers") or []:
    print("  d", t.get("tester_id"), t.get("status"), t.get("email"))

out = subprocess.check_output(
    ["systemctl", "show", "supernova-web", "-p", "Environment", "--value"],
    text=True,
)
print("env_snip", out[:300].replace("\n", " | "))
m = re.search(r"SUPERNOVA_API_TOKEN=(\S+)", out)
token = m.group(1) if m else Path("/opt/biotech/.supernova_api_token").read_text().strip()
req = urllib.request.Request(
    "http://127.0.0.1:8765/api/tester-feedback/summary",
    headers={"X-SuperNova-Token": token},
)
body = urllib.request.urlopen(req, timeout=60).read()
d = json.loads(body)
print("http_store_path", d.get("store_path"))
print("http_n", len(d.get("testers") or []), "pending", d.get("pending_testers"), "approved", d.get("approved_testers"))
for t in d.get("testers") or []:
    print("  h", t.get("tester_id"), t.get("status"), t.get("email"))
