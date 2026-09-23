#!/usr/bin/env python3
import json
from pathlib import Path

p = Path("/opt/biotech/data/tester_feedback_store.json")
d = json.loads(p.read_text(encoding="utf-8"))
testers = d.get("testers", d) if isinstance(d, dict) else d
needle = "alex"
found = []
if isinstance(testers, dict):
    for k, v in testers.items():
        blob = f"{k} {json.dumps(v, default=str)}"
        if needle in blob.lower() or "ross" in blob.lower():
            found.append((k, v))
elif isinstance(testers, list):
    for i, v in enumerate(testers):
        blob = json.dumps(v, default=str)
        if needle in blob.lower() or "ross" in blob.lower():
            found.append((i, v))

print("found", len(found))
for k, v in found:
    if isinstance(v, dict):
        keys = sorted(v.keys())
        print("---", k)
        for field in (
            "email",
            "tester_id",
            "id",
            "status",
            "approved",
            "access_status",
            "first_name",
            "last_name",
            "birth_year",
            "tax_id",
            "created_at",
            "approved_at",
            "session_token",
            "device_sessions",
        ):
            if field in v:
                print(f"  {field}: {v.get(field)!r}")
        # print any session-ish keys
        for kk in keys:
            if "session" in kk.lower() or "device" in kk.lower() or "token" in kk.lower():
                val = v[kk]
                s = json.dumps(val, default=str)
                print(f"  {kk}: {s[:300]}")
    else:
        print(k, v)
