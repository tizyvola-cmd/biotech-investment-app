#!/usr/bin/env python3
import json
from collections import Counter
from datetime import datetime, timezone

path = "/opt/biotech/data/tester_feedback_store.json"
with open(path, encoding="utf-8") as f:
    store = json.load(f)

tid = "alexross1948_at_gmail.com"
meta = (store.get("testers") or {}).get(tid) or {}
print("meta keys sample:", {k: meta.get(k) for k in [
    "email","display_name","status","session_ping_count","last_seen_at","usage_seconds_total"
]})
events = [e for e in (store.get("events") or []) if e.get("tester_id") == tid]
print("events", len(events))
print("kinds", Counter(e.get("kind") for e in events))
# last 15 events
evs = sorted(events, key=lambda e: e.get("ts") or e.get("created_at") or "", reverse=True)[:20]
for e in evs:
    print(e.get("ts") or e.get("created_at"), e.get("kind"), e.get("source"), str(e.get("payload"))[:120])

# ui_error any tester today
ui = [e for e in (store.get("events") or []) if e.get("kind") == "ui_error"]
print("ui_error total", len(ui))
for e in ui[-5:]:
    print(e.get("tester_id"), e.get("ts"), str(e.get("payload"))[:160])
