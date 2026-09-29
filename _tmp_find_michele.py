#!/usr/bin/env python3
import json
from pathlib import Path
store = json.loads(Path("/opt/biotech/data/tester_feedback_store.json").read_text(encoding="utf-8"))
testers = store.get("testers") or {}
for tid, meta in testers.items():
    if not isinstance(meta, dict):
        continue
    email = str(meta.get("email") or "").lower()
    name = str(meta.get("display_name") or "")
    if "michele" in email or "michele" in name.lower() or "michele" in tid.lower():
        print({
            "tester_id": tid,
            "email": meta.get("email"),
            "status": meta.get("status"),
            "premium": meta.get("premium"),
            "has_session_hash": bool(meta.get("session_token_hash")),
            "last_seen_at": meta.get("last_seen_at"),
        })
