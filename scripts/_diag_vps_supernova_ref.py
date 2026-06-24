#!/usr/bin/env python3
"""Diag SuperNova ref curve in simulation_charts_snapshot.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import SIMULATION_CHARTS_SNAPSHOT_JSON


def main() -> int:
    p = Path(SIMULATION_CHARTS_SNAPSHOT_JSON)
    if not p.is_file():
        print(f"MISSING {p}")
        return 1
    d = json.loads(p.read_text(encoding="utf-8"))
    ser = d.get("series") or {}
    print(f"path={p} series={len(ser)}")
    ref_keys = sorted(k for k in ser if str(k).startswith("ref:"))
    print("ref_keys:", ref_keys)
    for key in ref_keys:
        if "supernova" not in key.lower() and "cluster" not in key.lower() and "globale" not in key.lower():
            continue
        meta = ser[key]
        pts = meta.get("points") or []
        curva = [round(float(x.get("pct_curva", 0)), 2) for x in pts if isinstance(x, dict)]
        print(f"{key} label={meta.get('label')!r} n={len(curva)} curve={curva}")

    try:
        from ristretta_lab_data import build_reference_curves, load_past_pred_map

        refs = build_reference_curves(load_past_pred_map())
        sn = refs.get("SuperNova (cl.1)")
        print("live compute SuperNova table8:", [round(float(x), 2) if x is not None else None for x in (sn or [])])
    except Exception as exc:
        print("live compute failed:", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
