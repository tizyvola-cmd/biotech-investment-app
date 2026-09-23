import json
from pathlib import Path

import tester_feedback_io as tf

store = tf.load_store()
testers = store.get("testers") or {}
hits = []
for tid, meta in testers.items():
    if not isinstance(meta, dict):
        continue
    blob = f"{tid} {meta.get('email')} {meta.get('display_name')}".lower()
    if "alex" in blob or "ross" in blob or "alessandro" in blob:
        hits.append((tid, meta))

print("hits", len(hits))
for tid, meta in hits:
    print("---", tid)
    for k in (
        "email",
        "display_name",
        "status",
        "source",
        "created_at",
        "last_seen_at",
        "first_name",
        "last_name",
        "birth_year",
        "interest_other",
        "open_ui_issue_id",
        "session_token_hash",
        "session_issued_at",
    ):
        print(f"  {k}:", meta.get(k))
    access = tf.get_tester_access(tid)
    print("  access:", {k: access.get(k) for k in ("registered", "allowed", "status", "email")})

# recent ui errors for this tester
events = [e for e in (store.get("events") or []) if isinstance(e, dict)]
alex = [e for e in events if "alexross" in str(e.get("tester_id") or "")]
print("alex events", len(alex))
for e in alex[-8:]:
    pl = e.get("payload") if isinstance(e.get("payload"), dict) else {}
    print(
        e.get("created_at"),
        e.get("kind"),
        pl.get("label") or pl.get("problem"),
        str(pl.get("message") or "")[:120],
        "status=",
        pl.get("issue_status"),
    )
