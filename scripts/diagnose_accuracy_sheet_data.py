#!/usr/bin/env python3
"""Conteggio campi mancanti in JSON coorte Accuracy (diagnostica rapida)."""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main() -> int:
    from past_pred_io import load_past_pred_document, rows_map_from_doc
    from prediction.nct_cohort import select_nct_cohort

    j = os.path.join(_ROOT, "data", "past_catalyst_predictions.json")
    doc = load_past_pred_document(j)
    rows = rows_map_from_doc(doc)
    cohort = select_nct_cohort(rows, refresh_kind="accuracy")
    primary = cohort.primary
    n = len(primary)
    if n == 0:
        print("Coorte primaria vuota.")
        return 2

    def pct(has: int) -> str:
        return f"{100.0 * has / n:.1f}%"

    has_dm60 = sum(1 for r in primary.values() if r.get("model_dm60_pct") is not None)
    has_m60 = sum(
        1
        for r in primary.values()
        if r.get("close_m60") is not None or r.get("close_m60_cal") is not None
    )
    has_seq = sum(
        1
        for r in primary.values()
        if isinstance(r.get("seq_curve_pct_vs_m60"), list)
        and any(x is not None and x == x for x in r["seq_curve_pct_vs_m60"])
    )
    nodes = sum(
        1
        for r in primary.values()
        if any(r.get(k) is not None for k in ("model_dm7_pct", "model_dm30_pct", "d5_pct"))
    )
    print(f"Coorte primaria N={n}")
    print(f"  model_dm60_pct: {has_dm60} ({pct(has_dm60)})")
    print(f"  close_m60*:     {has_m60} ({pct(has_m60)})")
    print(f"  seq_curve:      {has_seq} ({pct(has_seq)})")
    print(f"  almeno 1 nodo:  {nodes} ({pct(nodes)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
