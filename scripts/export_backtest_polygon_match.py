#!/usr/bin/env python3
"""Export retro polygon match % for watch-enter backtest anchors.

Writes ``data/backtest_polygon_match.json`` keyed by ``TICKER|YYYY-MM-DD`` with
match at T−60 / T−30 / T−10 (backtest anchors T−90 / T−30 / T−14).

Run from repo root:
  python scripts/export_backtest_polygon_match.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map
from prediction.cd_pattern_polygon_accuracy import compute_polygon_match_pct

OUT_PATH = Path(DATA_DIR) / "backtest_polygon_match.json"
BACKTEST_OFFSETS: tuple[tuple[int, str], ...] = (
    (-60, "m60"),
    (-30, "m30"),
    (-10, "m10"),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def build_backtest_polygon_match_map(
    past_map: dict[str, dict] | None = None,
) -> dict[str, object]:
    src = past_map if past_map is not None else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    rows: dict[str, dict[str, object]] = {}
    n_computed = 0
    for key, rec in src.items():
        if not isinstance(rec, dict):
            continue
        ticker = str(rec.get("ticker") or key.split("|")[0] or "").strip().upper()
        cd = str(rec.get("completion_date") or "")[:10]
        if not ticker or not cd:
            continue
        map_key = f"{ticker}|{cd}"
        entry: dict[str, object] = {"ticker": ticker, "completion_date": cd}
        for offset, field in BACKTEST_OFFSETS:
            match = compute_polygon_match_pct(rec, offset)
            entry[f"match_{field}"] = match
            if match is not None:
                n_computed += 1
        rows[map_key] = entry
    return {
        "generated_at": _now_iso(),
        "source": str(PAST_CATALYST_PREDICTIONS_JSON),
        "n_keys": len(rows),
        "n_match_values": n_computed,
        "rows": rows,
    }


def main() -> None:
    doc = build_backtest_polygon_match_map()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(OUT_PATH)
    print(f"Wrote {OUT_PATH} — {doc['n_keys']} keys · {doc['n_match_values']} match values")


if __name__ == "__main__":
    main()
