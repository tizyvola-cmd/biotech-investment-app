#!/usr/bin/env python3
"""Export retro polygon match % for watch-enter backtest anchors.

Writes ``data/backtest_polygon_match.json`` keyed by ``TICKER|YYYY-MM-DD`` with
match at T−60 / T−30 / T−10 (backtest anchors T−90 / T−30 / T−14).

Sources (merged, live entries override past for same key):
  - ``data/past_catalyst_predictions.json``  — eventi storici
  - ``data/sim_live_pred_snapshot.json``      — posizioni correnti / CD upcoming

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
SIM_LIVE_PRED_PATH = Path(DATA_DIR) / "sim_live_pred_snapshot.json"

BACKTEST_OFFSETS: tuple[tuple[int, str], ...] = (
    (-60, "m60"),
    (-30, "m30"),
    (-10, "m10"),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _load_live_pred_map() -> dict[str, dict]:
    """Load sim_live_pred_snapshot and normalise to {TICKER|DATE: rec} format.

    The snapshot stores entries both as ``TICKER|DATE`` (with polygon data) and
    as plain ``TICKER`` (summary rows without CD).  We keep only the former and
    inject ``ticker`` / ``completion_date`` from the key.
    """
    if not SIM_LIVE_PRED_PATH.is_file():
        return {}
    try:
        doc = json.loads(SIM_LIVE_PRED_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    raw = doc.get("rows", {})
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict] = {}
    for key, rec in raw.items():
        if not isinstance(rec, dict) or "|" not in key:
            continue
        parts = key.split("|", 1)
        if len(parts) != 2:
            continue
        ticker, cd = parts[0].strip().upper(), parts[1][:10]
        if not ticker or len(cd) != 10:
            continue
        # Inject meta so compute_polygon_match_pct can find ticker/cd if needed
        merged = dict(rec)
        merged.setdefault("ticker", ticker)
        merged.setdefault("completion_date", cd)
        out[f"{ticker}|{cd}"] = merged
    return out


def _build_rows(src: dict[str, dict]) -> tuple[dict[str, dict], int]:
    rows: dict[str, dict[str, object]] = {}
    n_computed = 0
    for key, rec in src.items():
        if not isinstance(rec, dict):
            continue
        ticker = str(rec.get("ticker") or key.split("|")[0] or "").strip().upper()
        cd = str(rec.get("completion_date") or "")[:10]
        if not ticker or len(cd) != 10:
            continue
        map_key = f"{ticker}|{cd}"
        entry: dict[str, object] = {"ticker": ticker, "completion_date": cd}
        for offset, field in BACKTEST_OFFSETS:
            match = compute_polygon_match_pct(rec, offset)
            entry[f"match_{field}"] = match
            if match is not None:
                n_computed += 1
        rows[map_key] = entry
    return rows, n_computed


def build_backtest_polygon_match_map(
    past_map: dict[str, dict] | None = None,
    include_live: bool = True,
) -> dict[str, object]:
    """Build the merged polygon match map.

    ``past_map`` defaults to ``past_catalyst_predictions.json``.
    When ``include_live=True`` (default), entries from
    ``sim_live_pred_snapshot.json`` are merged in afterwards so that
    upcoming/current CDs are covered; live data takes precedence for
    duplicate keys.
    """
    base_map: dict[str, dict] = (
        past_map if past_map is not None
        else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    )
    live_map = _load_live_pred_map() if include_live else {}

    # Merge: start from base, then let live override / extend
    merged: dict[str, dict] = {**base_map, **live_map}

    rows, n_computed = _build_rows(merged)

    sources = [str(PAST_CATALYST_PREDICTIONS_JSON)]
    if live_map:
        sources.append(str(SIM_LIVE_PRED_PATH))

    return {
        "generated_at": _now_iso(),
        "source": ", ".join(sources),
        "n_keys": len(rows),
        "n_keys_past": len(base_map),
        "n_keys_live": len(live_map),
        "n_match_values": n_computed,
        "rows": rows,
    }


def main() -> None:
    doc = build_backtest_polygon_match_map()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(OUT_PATH)
    print(
        f"Wrote {OUT_PATH} — {doc['n_keys']} keys "
        f"(past={doc['n_keys_past']} live={doc['n_keys_live']}) "
        f"· {doc['n_match_values']} match values"
    )


if __name__ == "__main__":
    main()
