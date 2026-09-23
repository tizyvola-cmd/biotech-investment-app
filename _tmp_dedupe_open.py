#!/usr/bin/env python3
import json
from pathlib import Path

path = Path("/opt/biotech/data/tester_feedback_store.json")
store = json.loads(path.read_text(encoding="utf-8"))
tid = "alexross1948_at_gmail.com"
opens = []
for ev in store.get("events") or []:
    if not isinstance(ev, dict):
        continue
    if ev.get("tester_id") != tid or ev.get("kind") != "ui_error":
        continue
    pl = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
    if "manual probe" in f"{pl.get('label')} {pl.get('message')}".lower():
        continue
    if str(pl.get("issue_status") or "open").lower() != "open":
        continue
    opens.append(ev)
opens.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)
for i, ev in enumerate(opens):
    pl = ev.setdefault("payload", {})
    if i == 0:
        pl["issue_status"] = "open"
        pl["problem"] = pl.get("problem") or "entry_freeze_request_storm"
        meta = store.setdefault("testers", {}).setdefault(tid, {})
        meta["open_ui_issue_id"] = ev.get("id")
        meta["open_ui_issue_at"] = ev.get("created_at")
        meta["last_ui_error_at"] = ev.get("created_at")
        meta["last_ui_error_label"] = pl.get("label")
        meta["last_ui_error_message"] = str(pl.get("message") or "")[:400]
    else:
        pl["issue_status"] = "resolved"
        pl["issue_resolve_note"] = "superseded_duplicate"
path.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
print("kept_open", opens[0].get("id") if opens else None, "closed", max(0, len(opens) - 1))

import sys
sys.path.insert(0, "/opt/biotech")
from importlib import reload
import tester_feedback_io as tf
reload(tf)
s = tf.build_summary()
print("open_count", s.get("open_ui_issue_count"))
for e in s.get("open_ui_issues") or []:
    pl = e.get("payload") or {}
    print("-", e.get("tester_id"), pl.get("label"), pl.get("problem"))
