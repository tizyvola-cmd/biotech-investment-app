#!/usr/bin/env python3
"""Fast Simulation regen + desktop snapshot export (skip slow enrich)."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("ORCH_SKIP_FINANCIAL_ENRICH", "1")
os.environ.setdefault("ORCH_SKIP_SEC_K8", "1")
os.environ.setdefault("ORCH_SKIP_OPTIONS_PRED", "1")
os.environ.setdefault("ORCH_SKIP_LIQUIDITY_YF", "1")


def main() -> int:
    t0 = time.time()
    from orchestrator_io_paths import FINAL_XLSX
    from data_orchestrator import regenerate_simulation_sheet_quick

    print("[regen_sim_fast] workbook:", FINAL_XLSX, flush=True)
    ok = regenerate_simulation_sheet_quick(FINAL_XLSX)
    print("[regen_sim_fast] regenerate ok=", ok, "elapsed", round(time.time() - t0, 1), "s", flush=True)
    if not ok:
        return 1

    from excel_sheet_reader import export_desktop_snapshots

    print("[regen_sim_fast] export snapshots...", flush=True)
    export_desktop_snapshots(xlsx_path=FINAL_XLSX)
    print("[regen_sim_fast] export done", round(time.time() - t0, 1), "s", flush=True)

    snap_path = ROOT / "data" / "simulation_sheet_snapshot.json"
    snap = json.loads(snap_path.read_text(encoding="utf-8"))
    rows = snap.get("rows") or []
    lctx = sum(1 for r in rows if str(r.get("Ticker", "")).upper() == "LCTX")
    print(f"[regen_sim_fast] snapshot rows={len(rows)} LCTX={lctx}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
