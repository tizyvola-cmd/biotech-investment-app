#!/usr/bin/env python3
"""Ensure Alessandro freeze is an open Access issue with problem code."""
import json
from pathlib import Path

path = Path("/opt/biotech/data/tester_feedback_store.json")
store = json.loads(path.read_text(encoding="utf-8"))
tid = "alexross1948_at_gmail.com"
opened = 0
for ev in store.get("events") or []:
    if not isinstance(ev, dict):
        continue
    if ev.get("tester_id") != tid or ev.get("kind") != "ui_error":
        continue
    pl = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
    ev["payload"] = pl
    blob = f"{pl.get('label') or ''} {pl.get('message') or ''}".lower()
    if "manual probe" in blob:
        continue
    if str(pl.get("issue_status") or "").lower() == "resolved":
        continue
    pl["issue_status"] = "open"
    pl["problem"] = pl.get("problem") or "entry_freeze_request_storm"
    pl.setdefault("issue_opened_at", ev.get("created_at"))
    opened += 1
    meta = store.setdefault("testers", {}).setdefault(tid, {})
    meta["open_ui_issue_id"] = ev.get("id")
    meta["open_ui_issue_at"] = ev.get("created_at")
    meta["last_ui_error_at"] = ev.get("created_at")
    meta["last_ui_error_label"] = pl.get("label")
    meta["last_ui_error_message"] = str(pl.get("message") or "")[:400]
    meta["ui_error_count"] = int(meta.get("ui_error_count") or 0) or 1

path.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
print("open_marked", opened)

# quick summary check using deployed module after we copy file
import sys
sys.path.insert(0, "/opt/biotech")
