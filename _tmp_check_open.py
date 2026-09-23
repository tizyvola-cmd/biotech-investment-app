#!/usr/bin/env python3
import sys
sys.path.insert(0, "/opt/biotech")
from tester_feedback_io import build_summary
s = build_summary()
print("open_count", s.get("open_ui_issue_count"))
for e in (s.get("open_ui_issues") or [])[:8]:
    pl = e.get("payload") or {}
    print("-", e.get("id")[:8], e.get("tester_id"), pl.get("label"), pl.get("problem"), pl.get("issue_status"))
