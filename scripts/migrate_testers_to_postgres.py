#!/usr/bin/env python3
"""
Migrate tester JSON stores → Postgres.

Usage (on VPS after SUPERNOVA_DATABASE_URL is set)::

    /opt/biotech/.venv/bin/python scripts/migrate_testers_to_postgres.py
    /opt/biotech/.venv/bin/python scripts/migrate_testers_to_postgres.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from orchestrator_io_paths import DATA_DIR, TESTER_FEEDBACK_STORE_JSON  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("SUPERNOVA_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: set SUPERNOVA_DATABASE_URL first", file=sys.stderr)
        return 2

    import supernova_pg as pg
    import tester_pg_io as tpg

    store_path = Path(TESTER_FEEDBACK_STORE_JSON)
    if store_path.is_file():
        store = json.loads(store_path.read_text(encoding="utf-8"))
    else:
        store = {"schema_version": 2, "testers": {}, "events": []}

    sim_dir = Path(DATA_DIR) / "tester_sim_inputs"
    sim_docs: dict[str, dict] = {}
    if sim_dir.is_dir():
        for p in sim_dir.glob("*.json"):
            if p.name.endswith(".tmp"):
                continue
            try:
                doc = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(doc, dict):
                sim_docs[p.stem] = doc

    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    events = store.get("events") if isinstance(store.get("events"), list) else []
    print(
        f"JSON source: {len(testers)} testers, {len(events)} events, "
        f"{len(sim_docs)} sim-inputs → {pg._redact_url(url)}"
    )
    if args.dry_run:
        print("dry-run: no write")
        return 0

    pg.ensure_schema()
    result = tpg.migrate_from_json(store, sim_docs)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
