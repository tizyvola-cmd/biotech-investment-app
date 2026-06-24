#!/usr/bin/env python3
"""Diagnostica complementare: pred_forward vs segnali pre-CD (run-up, dir_v4).

Vogliamo capire:
  - Quando il run-up 30g pre-CD e` UP, la pred dice UP (coerente) o DOWN (rema contro)?
  - Quando dir_v4 (direzione modello) e` UP, pred_forward e` UP o invertita?
  - Hit% stratificato per quadrante run-up x pred (4 combinazioni)
  - Hit% stratificato per regime di mercato (run-up <0 = scetticismo, run-up>15 = euforia)

Se la pred e` SISTEMATICAMENTE contraria al run-up sui CD recenti, il bug e`
nella formula `pred_forward_pp = d7 - dm7` o nel calibratore v5 cohort prior.

Uso:
  python scripts/_diag_pred_vs_curve.py
"""
from __future__ import annotations

import io
import json
import sys
from collections import Counter
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

COHORT = Path("data/investment_decision_cohort.json")
BAND = 0.5


def classify(v: float, band: float = BAND) -> str:
    if v > band:
        return "UP"
    if v < -band:
        return "DOWN"
    return "FLAT"


def main() -> int:
    if not COHORT.is_file():
        print(f"[ERR] {COHORT} non trovato")
        return 1
    doc = json.loads(COHORT.read_text(encoding="utf-8"))
    rows: list[dict] = doc.get("rows", [])

    valid = []
    for r in rows:
        p = r.get("pred_forward_pp")
        a = r.get("realized_forward_pp")
        if p is None or a is None:
            continue
        valid.append(r)

    n = len(valid)
    print(f"=================================================================")
    print(f"  pred_forward vs segnali pre-CD  (n={n})")
    print(f"=================================================================")

    # --- A) Coerenza pred vs run_up_30d ---
    print(f"\nA) pred_forward direzione vs run_up_30d direzione")
    print(f"   (CD recenti: il modello dovrebbe inerire dalla curva pre-CD)")
    rup_buckets = [
        ("run-up < -5%",    lambda v: v is not None and v < -5),
        ("run-up -5..0%",   lambda v: v is not None and -5 <= v < 0),
        ("run-up 0..5%",    lambda v: v is not None and 0 <= v < 5),
        ("run-up 5..15%",   lambda v: v is not None and 5 <= v < 15),
        ("run-up 15..30%",  lambda v: v is not None and 15 <= v < 30),
        ("run-up >= 30%",   lambda v: v is not None and v >= 30),
    ]
    print(f"   bucket            n     pred_UP%   pred_DOWN%   actual_UP%   pred_dir==run_up_dir?")
    print(f"   ---------------   ---   --------   ----------   ----------   ---------------------")
    for name, pred in rup_buckets:
        chunk = [r for r in valid if pred(r.get("run_up_30d"))]
        if not chunk:
            continue
        n_c = len(chunk)
        n_up_pred = sum(1 for r in chunk if float(r["pred_forward_pp"]) > BAND)
        n_dn_pred = sum(1 for r in chunk if float(r["pred_forward_pp"]) < -BAND)
        n_up_act = sum(1 for r in chunk if float(r["realized_forward_pp"]) > BAND)
        # Coerenza pred_dir == sign(run_up): pred>0 quando run_up>0, pred<0 quando run_up<0
        n_coh = 0
        n_coh_den = 0
        for r in chunk:
            p = float(r["pred_forward_pp"])
            ru = r.get("run_up_30d")
            if ru is None or abs(ru) < 1 or abs(p) < BAND:
                continue
            n_coh_den += 1
            if (p > 0 and ru > 0) or (p < 0 and ru < 0):
                n_coh += 1
        coh = f"{100.0*n_coh/n_coh_den:.0f}% ({n_coh}/{n_coh_den})" if n_coh_den else "n/d"
        print(f"   {name:<15}  {n_c:>4}    {100*n_up_pred/n_c:5.1f}%      {100*n_dn_pred/n_c:5.1f}%       {100*n_up_act/n_c:5.1f}%      {coh}")

    # --- B) Quadrante run_up x pred ---
    print(f"\nB) Quadrante: run_up x pred_dir -> Hit% e mean(actual)")
    print(f"   ru\\pred           pred UP                  pred FLAT               pred DOWN")
    print(f"   --------------    --------------------     -------------------     ----------------------")
    # 3x3 nested: run_up_dir vs pred_dir
    for ru_name, ru_lo, ru_hi in [
        ("run_up >= +5", 5, 1e9),
        ("run_up [-5,5]", -5, 5),
        ("run_up < -5", -1e9, -5),
    ]:
        line = f"   {ru_name:<15}  "
        for pd_name, pd_lo, pd_hi in [
            ("pred>+0.5",  BAND, 1e9),
            ("|pred|<=0.5", -BAND, BAND),
            ("pred<-0.5", -1e9, -BAND),
        ]:
            chunk = [r for r in valid
                     if r.get("run_up_30d") is not None
                     and ru_lo <= float(r["run_up_30d"]) < ru_hi
                     and pd_lo <= float(r["pred_forward_pp"]) < pd_hi]
            if not chunk:
                line += f"{'(0)':<22}  "
                continue
            mean_a = sum(float(r["realized_forward_pp"]) for r in chunk) / len(chunk)
            # hit "direzionale tradizionale"
            n_hit = 0
            for r in chunk:
                p = float(r["pred_forward_pp"])
                a = float(r["realized_forward_pp"])
                if classify(p) == classify(a):
                    n_hit += 1
            hp = 100.0 * n_hit / len(chunk)
            line += f"n={len(chunk):>3} hit={hp:4.1f}% ma={mean_a:+5.2f}  "
        print(line)

    # --- C) Direzione v4 modello vs pred_forward ---
    print(f"\nC) dir_v4 (campo testuale 'direzione' modello pre-CD) vs pred_forward direzione")
    dir_counts: Counter = Counter()
    for r in valid:
        dv = str(r.get("dir_v4") or "").strip()
        p = float(r["pred_forward_pp"])
        dv_dir = "UP" if dv.startswith("▲") or dv.upper().startswith("UP") else (
                 "DOWN" if dv.startswith("▼") or dv.upper().startswith("DOWN") else "?")
        p_dir = classify(p)
        dir_counts[(dv_dir, p_dir)] += 1

    print(f"   dir_v4 \\ pred:  UP       FLAT     DOWN")
    print(f"   ----------------- ----    ----     ----")
    for dv in ("UP", "DOWN", "?"):
        row = "   " + f"{dv:<14}  "
        for p in ("UP", "FLAT", "DOWN"):
            row += f"{dir_counts.get((dv, p), 0):>4}    "
        print(row)
    # Lettura: se dir_v4=UP ma pred=DOWN (e viceversa) -> pred e` invertita rispetto al verdetto modello
    inv_dv = dir_counts.get(("UP", "DOWN"), 0) + dir_counts.get(("DOWN", "UP"), 0)
    coh_dv = dir_counts.get(("UP", "UP"), 0) + dir_counts.get(("DOWN", "DOWN"), 0)
    if (inv_dv + coh_dv) > 0:
        share_inv = 100.0 * inv_dv / (inv_dv + coh_dv)
        print(f"   --> dir_v4 e pred_forward in disaccordo {inv_dv}/{inv_dv+coh_dv} ({share_inv:.1f}%)")
        if share_inv > 60:
            print(f"       [SEGNALE FORTE] pred_forward sembra avere SEGNO OPPOSTO al verdetto modello!")
        elif share_inv > 50:
            print(f"       [SEGNALE DEBOLE] disaccordo > coerenza")
        else:
            print(f"       [OK] pred concorde col verdetto modello nella maggioranza dei casi")

    return 0


if __name__ == "__main__":
    sys.exit(main())
