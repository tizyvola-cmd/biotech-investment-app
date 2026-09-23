#!/usr/bin/env python3
import json
from pathlib import Path
d = json.loads(Path("/opt/biotech/data/tester_feedback_store.json").read_text(encoding="utf-8"))
for tid, m in (d.get("testers") or {}).items():
    if not isinstance(m, dict):
        continue
    print(tid, "|", m.get("email"), "|", m.get("status"), "| sess", bool(m.get("session_token_hash")), "| premium", m.get("premium"))
