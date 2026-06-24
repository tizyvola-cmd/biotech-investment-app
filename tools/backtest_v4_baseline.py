#!/usr/bin/env python3
"""
Backtest v4 baseline metrics on past catalyst records.

Loads ``data/past_catalyst_predictions.json`` (via ``past_pred_io``), keeps rows with
``completion_date`` strictly before today, and reports:

- Direction: hit rate vs ``d3_pct`` / ``d5_pct`` (T+3, fallback T+5), Brier score using
  ``direction_confidence`` when present else ``score_v4 / 100``.
- Curve: MAE at T-30, T-7, CD (+4 cal proxy), CD+7 between model fields and realized
  ``curve_act_pct`` (fallback: % vs ``close_m60`` from session closes).
- Incoherence: predicted ↑ but realized move at catalyst window < 0 (and symmetric ↓).

Assumptions (schema gaps):
- ``ok_v4`` is often absent on disk JSON; direction hit uses the same sign rules as
  ``data_orchestrator._is_direction_prediction_correct`` (stable band ±5 pp).
- CD curve node uses ``model_d4_pct`` / ``curve_act_pct['+4']`` as the nearest stored
  calendar offset to catalyst day (no offset 0 in the JSON).
- Incoherence uses ``d5_pct`` (fallback ``d3_pct``) as the realized move near CD.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON  # noqa: E402
from past_pred_io import load_past_pred_map, normalize_past_pred_record  # noqa: E402

_STABLE_BAND_PP = 5.0

# (label, calendar offset, pred field, actual curve key, close fields for fallback)
CURVE_CHECKPOINTS: tuple[tuple[str, int, str, str, tuple[str, ...]], ...] = (
    ("T-30", -30, "model_dm30_pct", "-30", ("close_m30", "close_m60")),
    ("T-7", -7, "model_dm7_pct", "-7", ("close_m7", "close_m60")),
    ("CD+4", 4, "model_d4_pct", "+4", ("close_p4", "close_m60")),
    ("CD+7", 7, "model_d7_pct", "+7", ("close_p7", "close_m60")),
)


@dataclass
class RowMetrics:
    key: str
    ticker: str
    completion_date: str
    dir_v4: str
    direction_hit: bool | None
    brier: float | None
    incoherent: bool | None
    curve_mae: dict[str, float | None]


def _parse_completion_date(rec: dict) -> date | None:
    cd = rec.get("completion_date")
    if isinstance(cd, date):
        return cd
    if isinstance(cd, str) and cd.strip():
        try:
            return date.fromisoformat(cd.strip()[:10])
        except ValueError:
            return None
    return None


def _is_past_catalyst(rec: dict, *, today: date | None = None) -> bool:
    cd = _parse_completion_date(rec)
    if cd is None:
        return False
    ref = today or date.today()
    return cd < ref


def _float_or_none(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def _actual_direction_pct(rec: dict) -> float | None:
    for key in ("d3_actual", "d5_actual", "d3_pct", "d5_pct"):
        v = _float_or_none(rec.get(key))
        if v is not None:
            return v
    return None


def _direction_hit(rec: dict, actual_pct: float | None) -> bool | None:
    if actual_pct is None:
        return None
    d = str(rec.get("dir_v4") or rec.get("direction") or "")
    if d.startswith("↑"):
        return actual_pct > 0
    if d.startswith("↓"):
        return actual_pct < 0
    if d.startswith("→"):
        return abs(actual_pct) < _STABLE_BAND_PP
    return None


def _pseudo_prob_up(rec: dict) -> float | None:
    conf = _float_or_none(rec.get("direction_confidence"))
    if conf is None:
        sc = _float_or_none(rec.get("score_v4"))
        if sc is not None:
            conf = max(0.05, min(1.0, sc / 100.0))
    if conf is None:
        return None
    d = str(rec.get("dir_v4") or rec.get("direction") or "")
    if d.startswith("↑"):
        return conf
    if d.startswith("↓"):
        return 1.0 - conf
    if d.startswith("→"):
        return 0.5
    return None


def _brier_score(rec: dict, actual_pct: float | None) -> float | None:
    p_up = _pseudo_prob_up(rec)
    if p_up is None or actual_pct is None:
        return None
    y = 1.0 if actual_pct > 0 else 0.0
    return (p_up - y) ** 2


def _move_at_cd(rec: dict) -> float | None:
    for key in ("d5_pct", "d3_pct", "d5_actual", "d3_actual"):
        v = _float_or_none(rec.get(key))
        if v is not None:
            return v
    return None


def _incoherent(rec: dict, move_cd: float | None) -> bool | None:
    if move_cd is None:
        return None
    d = str(rec.get("dir_v4") or rec.get("direction") or "")
    if d.startswith("↑"):
        return move_cd < 0
    if d.startswith("↓"):
        return move_cd > 0
    return None


def _curve_actual_pct(rec: dict, offset: int, curve_key: str, close_keys: tuple[str, ...]) -> float | None:
    curve = rec.get("curve_act_pct")
    if isinstance(curve, dict):
        for k in (curve_key, str(offset), f"{offset:+d}"):
            v = _float_or_none(curve.get(k))
            if v is not None:
                return v
    if len(close_keys) >= 2:
        px = _float_or_none(rec.get(close_keys[0]))
        base = _float_or_none(rec.get(close_keys[1]))
        if px is not None and base is not None and base > 0:
            return round((px / base - 1.0) * 100.0, 4)
    return None


def _curve_mae_for_row(rec: dict) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for label, _off, pred_key, curve_key, close_keys in CURVE_CHECKPOINTS:
        pred = _float_or_none(rec.get(pred_key))
        act = _curve_actual_pct(rec, _off, curve_key, close_keys)
        if pred is None or act is None:
            out[label] = None
        else:
            out[label] = abs(pred - act)
    return out


def evaluate_record(key: str, rec: dict) -> RowMetrics:
    rec = normalize_past_pred_record(dict(rec))
    cd = _parse_completion_date(rec)
    act = _actual_direction_pct(rec)
    move_cd = _move_at_cd(rec)
    return RowMetrics(
        key=key,
        ticker=str(rec.get("ticker") or key.split("|", 1)[0]),
        completion_date=cd.isoformat() if cd else "",
        dir_v4=str(rec.get("dir_v4") or rec.get("direction") or ""),
        direction_hit=_direction_hit(rec, act),
        brier=_brier_score(rec, act),
        incoherent=_incoherent(rec, move_cd),
        curve_mae=_curve_mae_for_row(rec),
    )


def load_past_rows(json_path: str | Path | None = None) -> dict[str, dict]:
    path = str(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    return load_past_pred_map(path)


def filter_past_rows(rows: dict[str, dict], *, today: date | None = None) -> dict[str, dict]:
    return {k: v for k, v in rows.items() if _is_past_catalyst(v, today=today)}


def aggregate_metrics(row_metrics: Iterable[RowMetrics]) -> dict[str, Any]:
    rows = list(row_metrics)
    n = len(rows)
    hits = [r.direction_hit for r in rows if r.direction_hit is not None]
    briers = [r.brier for r in rows if r.brier is not None]
    incoh = [r.incoherent for r in rows if r.incoherent is not None]
    summary: dict[str, Any] = {
        "n_rows": n,
        "direction_n": len(hits),
        "direction_hit_rate": (sum(1 for h in hits if h) / len(hits)) if hits else None,
        "brier_mean": (sum(briers) / len(briers)) if briers else None,
        "incoherence_pct": (
            100.0 * sum(1 for x in incoh if x) / len(incoh) if incoh else None
        ),
        "incoherence_n": len(incoh),
    }
    for label, *_ in CURVE_CHECKPOINTS:
        maes = [r.curve_mae.get(label) for r in rows if r.curve_mae.get(label) is not None]
        summary[f"mae_{label}"] = (sum(maes) / len(maes)) if maes else None
        summary[f"mae_{label}_n"] = len(maes)
    return summary


def write_csv_report(row_metrics: Iterable[RowMetrics], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "key",
        "ticker",
        "completion_date",
        "dir_v4",
        "direction_hit",
        "brier",
        "incoherent",
    ] + [f"mae_{label}" for label, *_ in CURVE_CHECKPOINTS]
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for r in row_metrics:
            row = {
                "key": r.key,
                "ticker": r.ticker,
                "completion_date": r.completion_date,
                "dir_v4": r.dir_v4,
                "direction_hit": r.direction_hit,
                "brier": r.brier,
                "incoherent": r.incoherent,
            }
            for label, *_ in CURVE_CHECKPOINTS:
                row[f"mae_{label}"] = r.curve_mae.get(label)
            w.writerow(row)


def print_summary(summary: dict[str, Any], *, csv_path: Path) -> None:
    print("=== v4 baseline backtest (past catalysts) ===")
    print(f"Rows (past CD): {summary['n_rows']}")
    if summary["direction_n"]:
        hr = summary["direction_hit_rate"]
        print(
            f"Direction hit rate: {hr * 100:.1f}%  (n={summary['direction_n']})"
            if hr is not None
            else "Direction hit rate: n/d"
        )
    else:
        print("Direction hit rate: n/d (no d3/d5 actuals)")
    if summary["brier_mean"] is not None:
        print(f"Brier (mean): {summary['brier_mean']:.4f}  (pseudo-p from confidence/score_v4)")
    else:
        print("Brier (mean): n/d")
    if summary["incoherence_n"]:
        print(
            f"Incoherence: {summary['incoherence_pct']:.1f}%  "
            f"(n={summary['incoherence_n']}, move=d5_pct|d3_pct)"
        )
    else:
        print("Incoherence: n/d")
    for label, *_ in CURVE_CHECKPOINTS:
        mae = summary.get(f"mae_{label}")
        nn = summary.get(f"mae_{label}_n", 0)
        if mae is not None:
            print(f"MAE {label}: {mae:.2f} pp  (n={nn})")
        else:
            print(f"MAE {label}: n/d")
    print(f"CSV: {csv_path.resolve()}")


def run_backtest(
    json_path: str | Path | None = None,
    *,
    csv_path: Path | None = None,
    today: date | None = None,
) -> tuple[dict[str, Any], list[RowMetrics]]:
    rows = load_past_rows(json_path)
    past = filter_past_rows(rows, today=today)
    metrics = [evaluate_record(k, v) for k, v in sorted(past.items())]
    summary = aggregate_metrics(metrics)
    out = csv_path or (_ROOT / "data" / "backtest_v4_baseline.csv")
    write_csv_report(metrics, out)
    return summary, metrics


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Backtest v4 baseline on past catalyst JSON.")
    ap.add_argument("--json", default=None, help="past_catalyst_predictions.json path")
    ap.add_argument(
        "--csv",
        default=str(_ROOT / "data" / "backtest_v4_baseline.csv"),
        help="Output CSV path",
    )
    ap.add_argument(
        "--as-of",
        default=None,
        help="ISO date for 'today' filter (default: real today)",
    )
    args = ap.parse_args(argv)
    as_of = date.fromisoformat(args.as_of) if args.as_of else None
    summary, _ = run_backtest(args.json, csv_path=Path(args.csv), today=as_of)
    print_summary(summary, csv_path=Path(args.csv))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
