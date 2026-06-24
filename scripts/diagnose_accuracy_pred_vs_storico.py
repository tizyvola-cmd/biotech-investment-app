#!/usr/bin/env python3
"""
Confronta Pred % vs Storico % sul foglio Accuracy (proxy da JSON + HistLib).

Eseguire dalla root progetto (Excel chiuso):
  py -3 scripts\\diagnose_accuracy_pred_vs_storico.py
  py -3 scripts\\diagnose_accuracy_pred_vs_storico.py --limit 80 --past-only

Segnala righe dove Pred (live/seq) è quasi identico a Storico — tipico bug
``past_accuracy_k8`` su CD passate invece del modello v4.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

OFFSETS = (-60, -30, -10, -7, -5, -3, 4, 7)


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _parse_cd(s: str | None) -> date | None:
    if not s:
        return None
    s = str(s).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _mae(a: list[float | None], b: list[float | None]) -> float | None:
    diffs: list[float] = []
    for x, y in zip(a, b):
        if x is None or y is None:
            continue
        diffs.append(abs(float(x) - float(y)))
    return statistics.mean(diffs) if diffs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=120)
    ap.add_argument("--past-only", action="store_true")
    ap.add_argument("--mae-threshold", type=float, default=1.5, help="pp medi Pred-Storico")
    args = ap.parse_args()

    past_path = ROOT / "data" / "past_catalyst_predictions.json"
    if not past_path.is_file():
        print(f"Manca {past_path}")
        return 1

    rows = json.loads(past_path.read_text(encoding="utf-8")).get("rows") or {}
    today = date.today()
    ser_cache: dict = {}

    from prediction.live_recalib_sheet import (
        past_accuracy_k8_recalib_pct_points,
        past_accuracy_model_pred_pct_points,
    )

    diffs_live_model: list[float] = []
    clones: list[tuple[str, float]] = []

    n = 0
    for key, row in rows.items():
        if not isinstance(row, dict):
            continue
        cd_s = row.get("completion_date") or (str(key).split("|")[-1] if "|" in str(key) else None)
        cd = _parse_cd(str(cd_s) if cd_s else None)
        if cd is None:
            continue
        is_past = cd < today
        if args.past_only and not is_past:
            continue
        tk = str(row.get("ticker") or str(key).split("|")[0]).strip().upper()
        if not tk:
            continue

        try:
            pred_live = past_accuracy_k8_recalib_pct_points(row, row, cd, ser_cache=ser_cache)
            pred_model = past_accuracy_model_pred_pct_points(row, row)
        except Exception as exc:
            print(f"  skip {key}: {exc}")
            continue

        mae_lm = _mae(pred_live, pred_model)
        if mae_lm is None:
            continue
        diffs_live_model.append(mae_lm)
        if is_past and mae_lm < args.mae_threshold:
            clones.append((f"{tk}|{cd}", mae_lm))
        n += 1
        if n >= args.limit:
            break

    print("=== Diagnostica Accuracy: Pred live vs Pred modello (CD passate) ===\n")
    print(f"Righe analizzate: {n}  (past-only={args.past_only})")
    if diffs_live_model:
        print(f"MAE medio |Pred_live − Pred_model|: {statistics.mean(diffs_live_model):.2f} pp")
    print(
        f"Righe con Pred_live ≈ Pred_model (MAE < {args.mae_threshold} pp) "
        f"→ in Excel anche ≈ Storico: {len(clones)}"
    )
    if clones[:15]:
        print("\nEsempi (ticker|CD, MAE pp):")
        for k, m in clones[:15]:
            print(f"  {k}  {m:.2f}")
    print(
        "\nFix applicato: sotto la linea viola Pred = modello v4 "
        "(non live_recalib). Rigenera workbook / snapshot dopo il deploy."
    )
    print("Legacy: ACCURACY_PAST_PRED_USE_LIVE=1 ripristina il vecchio comportamento.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
