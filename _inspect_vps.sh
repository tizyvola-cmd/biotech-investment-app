#!/bin/bash
python3 <<'PY'
import json
with open("/opt/biotech/data/tester_feedback_store.json") as f:
    d = json.load(f)
print(f"schema_version: {d.get('schema_version')}")
print(f"updated_at: {d.get('updated_at')}")
print(f"testers: {len(d.get('testers', {}))}")
print()
for k, v in d.get("testers", {}).items():
    print(f"--- {k} ---")
    for field in ("status", "source", "email", "display_name", "created_at",
                  "last_seen_at", "status_updated_at", "approval_email_sent_at"):
        val = v.get(field)
        if val is not None:
            print(f"  {field}: {val}")
    mail = v.get("approval_email")
    if isinstance(mail, dict):
        print(f"  approval_email.ok: {mail.get('ok')}")
        print(f"  approval_email.reason: {mail.get('reason')}")
        print(f"  approval_email.to: {mail.get('to')}")
PY
