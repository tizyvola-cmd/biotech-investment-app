#!/usr/bin/env python3
"""Record Alessandro's diagnosed entry freeze so Access shows who + what."""
import sys
sys.path.insert(0, "/opt/biotech")
from tester_feedback_io import append_event, build_summary

ev = append_event(
    tester_id="alexross1948_at_gmail.com",
    display_name="Alessandro rossetti",
    module="dashboard",
    kind="ui_error",
    source="api",
    payload={
        "label": "Catalyst desk freeze",
        "message": (
            "UI freeze on entry (not a React exception): client flooded the API with "
            "parallel reloadSimulation + calendar/hype/manual snapshots (~9/sec). "
            "Session stayed alive (session_ping) so minutes kept rising while the desk "
            "was unusable. Root cause fixed 2026-09-19 (fetch coalescing + boot watchdog)."
        ),
        "problem": "entry_freeze_request_storm",
        "source": "ops_diagnosis",
    },
)
print("recorded", ev.get("id"), ev.get("created_at"))
s = build_summary()
print("ui_error_count_24h", s.get("ui_error_count"))
print("recent", len(s.get("recent_ui_errors") or []))
for e in (s.get("recent_ui_errors") or [])[:3]:
    pl = e.get("payload") or {}
    print("-", e.get("tester_id"), pl.get("label"), str(pl.get("message"))[:100])
alex = next((t for t in s.get("testers") or [] if "alexross" in str(t.get("tester_id"))), None)
if alex:
    print(
        "alex last_ui_error_at",
        alex.get("last_ui_error_at"),
        alex.get("last_ui_error_label"),
        str(alex.get("last_ui_error_message") or "")[:120],
    )
