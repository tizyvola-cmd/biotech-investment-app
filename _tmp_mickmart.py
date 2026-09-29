#!/usr/bin/env python3
import json
from pathlib import Path
p = Path("/opt/biotech/data/tester_feedback_store.json")
d = json.loads(p.read_text(encoding="utf-8"))
testers = d.get("testers") or {}
needle = "mickmart"
hits = []
for tid, m in testers.items():
    if not isinstance(m, dict):
        continue
    blob = f"{tid} {m.get('email')} {m.get('display_name')}".lower()
    if needle in blob or "mickmart" in blob:
        hits.append((tid, m))
print("hits", len(hits))
for tid, m in hits:
    print(json.dumps({
        "tester_id": tid,
        "email": m.get("email"),
        "display_name": m.get("display_name"),
        "status": m.get("status"),
        "premium": m.get("premium"),
        "has_session": bool(m.get("session_token_hash")),
        "created_at": m.get("created_at"),
        "last_seen_at": m.get("last_seen_at"),
        "allowed_keys": sorted(m.keys()),
    }, indent=2, ensure_ascii=False))
# also scan events for this email
ev = [e for e in (d.get("events") or []) if isinstance(e, dict) and "mickmart" in json.dumps(e).lower()]
print("events_mention", len(ev))
for e in ev[-5:]:
    print(e.get("kind"), e.get("tester_id"), e.get("created_at"), str(e.get("payload"))[:120])
