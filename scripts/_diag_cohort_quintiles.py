#!/usr/bin/env python3
"""Diagnostica veloce: stampa i quintili del cohort Decision Lab.

Verifica se i quintili hanno valori effettivamente diversi (Hit%, n, ranges)
o se tutti contengono gli stessi numeri (indicatore di bug a monte).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PATH = Path("data/investment_decision_cohort.json")


def main() -> int:
    if not PATH.is_file():
        print(f"[ERR] {PATH} non trovato")
        return 1

    doc = json.loads(PATH.read_text(encoding="utf-8"))
    q = doc.get("quintiles", [])
    summary = doc.get("summary", {})

    print(f"Generated at:  {doc.get('generated_at')}")
    print(f"Schema ver:    {doc.get('schema_version')}")
    print(f"Source:        {doc.get('source')}")
    print(f"Summary:       n_events={summary.get('n_events')}  n_ic={summary.get('n_ic_pairs')}  hit_global={summary.get('hit_rate_pct')}%")
    print()
    print(f"Quintili ({len(q)}):")
    print(f"  {'Qx':>3}  {'Label':>4}  {'aff_min':>8}  {'aff_max':>8}  {'n':>5}  {'hit%':>6}  {'mean_r':>7}")
    print(f"  {'-'*3}  {'-'*4}  {'-'*8}  {'-'*8}  {'-'*5}  {'-'*6}  {'-'*7}")
    for x in q:
        print(
            f"  Q{x.get('quintile')!s:>2}  {x.get('label', '?')!s:>4}  "
            f"{x.get('aff_min', 0):>7.1f}%  {x.get('aff_max', 0):>7.1f}%  "
            f"{x.get('n', 0)!s:>5}  {x.get('hit_rate_pct', 0)!s:>5}%  "
            f"{x.get('mean_r_hold_pp', 0)!s:>7}"
        )

    # Sanity check: tutti i quintili hanno valori identici?
    if len(q) >= 2:
        hits = {x.get("hit_rate_pct") for x in q}
        ns = {x.get("n") for x in q}
        if len(hits) == 1:
            print(f"\n[ANOMALIA] Tutti i quintili hanno lo stesso hit_rate_pct = {hits.pop()}!")
        if len(ns) == 1:
            print(f"[ANOMALIA] Tutti i quintili hanno la stessa n = {ns.pop()}!")
        if len(hits) > 1 and len(ns) > 1:
            print("\n[OK] Quintili eterogenei (hit% e n variano)")

    # Conteggio rows e distribuzione affidabilità
    rows = doc.get("rows", [])
    if rows:
        affs = [r.get("affidabilita_pct") for r in rows if r.get("affidabilita_pct") is not None]
        if affs:
            affs.sort()
            print(f"\nRows totali: {len(rows)}, con affid: {len(affs)}")
            print(f"  min={affs[0]:.1f}  p25={affs[len(affs)//4]:.1f}  med={affs[len(affs)//2]:.1f}  p75={affs[3*len(affs)//4]:.1f}  max={affs[-1]:.1f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
