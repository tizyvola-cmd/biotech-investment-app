#!/usr/bin/env python3
"""Simula Hit% del cohort applicando filtri combinati.

Risponde: se filtriamo per (CD>=2022 AND Aff>=85 AND |pred|>=1), che Hit% otteniamo?
E se invertissimo il segno della pred sui filtri stretti?

Uso:
  python scripts/_diag_filtered_cohort.py
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

COHORT = Path("data/investment_decision_cohort.json")
BAND = 0.5


def hit(p: float, a: float, band: float = BAND) -> bool:
    if abs(a) <= band:
        return abs(p) <= band
    return (p > band and a > band) or (p < -band and a < -band)


def measure(rows: list[dict], label: str, invert: bool = False) -> None:
    valid = [r for r in rows
             if r.get("pred_forward_pp") is not None
             and r.get("realized_forward_pp") is not None]
    n = len(valid)
    if n == 0:
        print(f"  {label:<56} n=  0  hit=--    ic=--")
        return
    n_hit = 0
    for r in valid:
        p = float(r["pred_forward_pp"])
        if invert:
            p = -p
        a = float(r["realized_forward_pp"])
        if hit(p, a):
            n_hit += 1
    hit_pct = 100.0 * n_hit / n
    # IC (segno concordance semplificato)
    n_up_pred = sum(1 for r in valid if (-float(r["pred_forward_pp"]) if invert else float(r["pred_forward_pp"])) > BAND)
    n_dn_pred = sum(1 for r in valid if (-float(r["pred_forward_pp"]) if invert else float(r["pred_forward_pp"])) < -BAND)
    n_up_act = sum(1 for r in valid if float(r["realized_forward_pp"]) > BAND)
    n_dn_act = sum(1 for r in valid if float(r["realized_forward_pp"]) < -BAND)
    # baseline random a 3 classi
    pp_up = n_up_pred / n
    pp_dn = n_dn_pred / n
    pp_fl = 1 - pp_up - pp_dn
    pa_up = n_up_act / n
    pa_dn = n_dn_act / n
    pa_fl = 1 - pa_up - pa_dn
    rand = 100.0 * (pp_up * pa_up + pp_dn * pa_dn + pp_fl * pa_fl)
    edge = hit_pct - rand
    flag = " [EDGE FORTE]" if edge > 5 else " [edge debole]" if edge > 0 else " [sotto random]"
    print(f"  {label:<56} n={n:>3}  hit={hit_pct:5.1f}%  rand={rand:.1f}%  edge={edge:+5.1f}pp{flag}")


def main() -> int:
    if not COHORT.is_file():
        print(f"[ERR] {COHORT} non trovato")
        return 1
    doc = json.loads(COHORT.read_text(encoding="utf-8"))
    rows: list[dict] = doc.get("rows", [])

    print(f"=================================================================")
    print(f"  Simulazione Hit% con filtri combinati")
    print(f"=================================================================")
    print(f"\n  [SEGNO PRED = NORMALE]")
    measure(rows, "Tutto il cohort", invert=False)
    measure([r for r in rows if (r.get("completion_date") or "")[:10] >= "2022-01-01"], "CD >= 2022-01-01", invert=False)
    measure([r for r in rows if (r.get("completion_date") or "")[:10] >= "2023-01-01"], "CD >= 2023-01-01", invert=False)
    measure([r for r in rows if (r.get("completion_date") or "")[:10] >= "2024-01-01"], "CD >= 2024-01-01", invert=False)
    measure([r for r in rows if (r.get("affidabilita_pct") or 0) >= 85], "Aff >= 85%", invert=False)
    measure([r for r in rows if r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 1.0], "|pred| >= 1.0pp", invert=False)
    measure([r for r in rows if r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 2.0], "|pred| >= 2.0pp", invert=False)
    measure([r for r in rows
             if (r.get("affidabilita_pct") or 0) >= 85
             and r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 1.0],
            "Aff >= 85% AND |pred| >= 1.0pp", invert=False)
    measure([r for r in rows
             if (r.get("affidabilita_pct") or 0) >= 85
             and (r.get("completion_date") or "")[:10] >= "2022-01-01"
             and r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 1.0],
            "Aff >= 85% AND CD >= 2022 AND |pred| >= 1.0pp", invert=False)
    measure([r for r in rows
             if (r.get("affidabilita_pct") or 0) >= 85
             and (r.get("completion_date") or "")[:10] >= "2022-01-01"
             and r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 2.0],
            "Aff >= 85% AND CD >= 2022 AND |pred| >= 2.0pp", invert=False)
    measure([r for r in rows
             if (r.get("affidabilita_pct") or 0) >= 70
             and (r.get("completion_date") or "")[:10] >= "2022-01-01"
             and r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 1.0],
            "Aff >= 70% AND CD >= 2022 AND |pred| >= 1.0pp", invert=False)

    print(f"\n  [SEGNO PRED = INVERTITO (test diagnostico)]")
    measure(rows, "Tutto il cohort", invert=True)
    measure([r for r in rows if (r.get("completion_date") or "")[:10] >= "2022-01-01"], "CD >= 2022-01-01", invert=True)
    measure([r for r in rows if (r.get("completion_date") or "")[:10] >= "2024-01-01"], "CD >= 2024-01-01", invert=True)
    measure([r for r in rows if (r.get("affidabilita_pct") or 0) >= 85], "Aff >= 85%", invert=True)
    measure([r for r in rows
             if (r.get("affidabilita_pct") or 0) >= 85
             and (r.get("completion_date") or "")[:10] >= "2022-01-01"
             and r.get("pred_forward_pp") is not None and abs(float(r["pred_forward_pp"])) >= 1.0],
            "Aff >= 85% AND CD >= 2022 AND |pred| >= 1.0pp", invert=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
