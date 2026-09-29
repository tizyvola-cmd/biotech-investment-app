#!/usr/bin/env python3
import json
from pathlib import Path
d = json.loads(Path("/opt/biotech/data/tester_feedback_store.json").read_text())
n = json.loads(Path("/opt/biotech/data/cache/daily_news_desk.json").read_text())
print("testers", len(d.get("testers") or {}))
print("events", len(d.get("events") or []))
print("briefs", len(n.get("briefs") or {}))
print("top_news", len(n.get("top_news") or []))
print("highlights", len(n.get("highlights") or []))
print("sim_books", len(list(Path("/opt/biotech/data/tester_sim_inputs").glob("*.json"))))
