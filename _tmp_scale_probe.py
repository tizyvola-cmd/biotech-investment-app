#!/usr/bin/env python3
"""Scale baseline probe — run on VPS."""
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

ROOT = Path("/opt/biotech")
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

# Load host env if present
env_path = ROOT / "config" / "profiles" / "desktop_web_host.env"
if env_path.is_file():
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import supernova_pg as pg

print("===PG===", "enabled", pg.enabled(), "url_set", bool(pg.database_url()))

tf = json.loads((ROOT / "data" / "tester_feedback_store.json").read_text(encoding="utf-8"))
testers = tf.get("testers") or {}
events = tf.get("events") or []
print("===TF===", "testers", len(testers), "events", len(events), "bytes", (ROOT / "data" / "tester_feedback_store.json").stat().st_size)
statuses = Counter(str((m or {}).get("status") or (m or {}).get("access") or "?") for m in testers.values() if isinstance(m, dict))
print("statuses", dict(statuses))
types = Counter(str(e.get("type") or e.get("event_type") or "unk") for e in events if isinstance(e, dict))
print("event_types_top", types.most_common(12))

dn = json.loads((ROOT / "data" / "cache" / "daily_news_desk.json").read_text(encoding="utf-8"))
briefs = dn.get("briefs") or dn.get("brief_cache") or {}
print("===DN===", "keys", list(dn.keys())[:25], "briefs", len(briefs) if isinstance(briefs, dict) else type(briefs).__name__)

mob = ROOT / "data" / "mobile_dashboard_snapshot.json"
print("===MOB===", "bytes", mob.stat().st_size if mob.is_file() else 0)

# Estimate events growth: events per tester
by_t = Counter(str(e.get("tester_id") or "?") for e in events if isinstance(e, dict))
print("events_per_tester_top", by_t.most_common(8))
print("avg_events_per_tester", round(len(events) / max(1, len(testers)), 1))

# Project to 1000 users at current avg
proj_events = int(1000 * (len(events) / max(1, len(testers))))
proj_bytes = int((ROOT / "data" / "tester_feedback_store.json").stat().st_size * (1000 / max(1, len(testers))))
print("===PROJ_1k===", "events", proj_events, "store_bytes_naive", proj_bytes)

sim_dir = ROOT / "data" / "tester_sim_inputs"
sims = list(sim_dir.glob("*.json")) if sim_dir.is_dir() else []
print("===SIM===", "files", len(sims))
