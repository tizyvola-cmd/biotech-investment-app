#!/usr/bin/env python3
from __future__ import annotations
import os, sys
from pathlib import Path
ROOT = Path("/opt/biotech")
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
env_path = ROOT / "config" / "profiles" / "desktop_web_host.env"
for line in env_path.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import supernova_pg as pg
print("enabled", pg.enabled())
pg.ensure_schema()
with pg.connection() as conn:
    with conn.cursor() as cur:
        cur.execute("select count(*) as n from sn_testers")
        print("pg_testers", cur.fetchone()["n"])
        cur.execute("select count(*) as n from sn_tester_events")
        print("pg_events", cur.fetchone()["n"])
        cur.execute("select count(*) as n from sn_tester_sim_inputs")
        print("pg_sim", cur.fetchone()["n"])

import tester_feedback_io as tf
store = tf.load_store()
print("load_store_testers", len(store.get("testers") or {}))
print("load_store_events", len(store.get("events") or []))
