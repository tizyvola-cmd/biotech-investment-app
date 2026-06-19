#!/usr/bin/env python3
"""Verifica se il segno della pred e` invertito (anti-correlazione sistematica)
o se il problema e` un mix temporale di modelli diversi.

Test:
  A) Hit% calcolato con sign(pred) NORMALE  vs  sign(pred) INVERTITO
  B) Stratificazione per anno completion_date
  C) Stratificazione per affidabilita
  D) Spearman normale vs invertito

Uso:
  python scripts/_diag_pred_sign_check.py
"""
from __future__ import annotations

import io
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

COHORT = Path("data/investment_decision_cohort.json")
BAND = 0.5


def hit(p: float, a: float, band: float = BAND) -> bool:
    if abs(a) <= band:
        return abs(p) <= band
    return (p > band and a > band) or (p < -band and a < -band)


def hit_inverted(p: float, a: float, band: float = BAND) -> bool:
    """Inverte il segno della pred prima di confrontare."""
    return hit(-p, a, band)


def hit_rate(pairs: list[tuple[float, float]], invert: bool = False) -> float | None:
    if not pairs:
        return None
    f = hit_inverted if invert else hit
    n_hit = sum(1 for p, a in pairs if f(p, a))
    return round(100.0 * n_hit / len(pairs), 1)


def rank(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(pairs: list[tuple[float, float]]) -> float | None:
    if len(pairs) < 3:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    rx = rank(xs)
    ry = rank(ys)
    mx = sum(rx) / len(rx)
    my = sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den_x = math.sqrt(sum((a - mx) ** 2 for a in rx))
    den_y = math.sqrt(sum((b - my) ** 2 for b in ry))
    if den_x < 1e-12 or den_y < 1e-12:
        return None
    return round(num / (den_x * den_y), 4)


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
        cd = (r.get("completion_date") or "")[:10]
        if p is None or a is None or not cd:
            continue
        valid.append((float(p), float(a), cd, r))

    n = len(valid)
    pairs = [(p, a) for p, a, _, _ in valid]

    print(f"===========================================")
    print(f"  TEST SEGNO PREDIZIONE  (n={n}, band=+/-{BAND}pp)")
    print(f"===========================================")

    # --- A) HIT% NORMALE vs INVERTITO globale ---
    h_norm = hit_rate(pairs, invert=False)
    h_inv = hit_rate(pairs, invert=True)
    sp_norm = spearman(pairs)
    sp_inv = spearman([(-p, a) for p, a in pairs])
    print(f"\nA) Globale")
    print(f"   Hit% normale     = {h_norm}%   Spearman = {sp_norm}")
    print(f"   Hit% INVERTITO   = {h_inv}%   Spearman = {sp_inv}")
    if h_inv is not None and h_norm is not None:
        delta = h_inv - h_norm
        if delta > 5:
            print(f"   --> [SEGNALE FORTE] Invertendo il segno l'edge aumenta di +{delta:.1f}pp")
            print(f"       Verosimile inversione sistematica nel calcolo pred_forward_pp.")
        elif delta > 2:
            print(f"   --> [SEGNALE DEBOLE] Inversione migliora di +{delta:.1f}pp")
        elif abs(delta) <= 2:
            print(f"   --> [NESSUN SEGNALE] Inversione non sposta significativamente ({delta:+.1f}pp)")
        else:
            print(f"   --> [SEGNO CORRETTO] Inversione peggiora ({delta:+.1f}pp), il segno e` quello giusto")

    # --- B) STRATIFICAZIONE PER ANNO ---
    by_year: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for p, a, cd, _ in valid:
        y = cd[:4]
        if y.isdigit():
            by_year[y].append((p, a))
    print(f"\nB) Stratificazione per anno completion_date")
    print(f"   anno    n      hit%_norm   hit%_inv    delta    sp_norm   sp_inv")
    print(f"   ----    ----   ---------   --------    -----    -------   ------")
    for y in sorted(by_year.keys()):
        ps = by_year[y]
        if len(ps) < 5:
            continue
        hn = hit_rate(ps, invert=False)
        hi = hit_rate(ps, invert=True)
        sn = spearman(ps)
        si = spearman([(-p, a) for p, a in ps])
        d = (hi or 0) - (hn or 0)
        flag = "  <-- inv MEGLIO" if d > 5 else "  <-- norm MEGLIO" if d < -5 else ""
        print(f"   {y}    {len(ps):>4}   {hn:>6}%     {hi:>6}%    {d:+6.1f}    {sn!s:>7}   {si!s:>7}{flag}")

    # --- C) STRATIFICAZIONE PER AFFIDABILITA ---
    print(f"\nC) Stratificazione per affidabilita_pct")
    print(f"   bucket             n     hit%_norm   hit%_inv    delta")
    print(f"   ----------------   ---   ---------   --------    -----")
    buckets = [
        ("Aff <30%",  lambda v: v is not None and v < 30),
        ("Aff 30-50", lambda v: v is not None and 30 <= v < 50),
        ("Aff 50-70", lambda v: v is not None and 50 <= v < 70),
        ("Aff 70-85", lambda v: v is not None and 70 <= v < 85),
        ("Aff >=85%", lambda v: v is not None and v >= 85),
        ("Aff n/d",   lambda v: v is None),
    ]
    for name, pred in buckets:
        ps = [(p, a) for p, a, _, r in valid if pred(r.get("affidabilita_pct"))]
        if len(ps) < 5:
            print(f"   {name:<16}  {len(ps):>3}   --          --          --")
            continue
        hn = hit_rate(ps, invert=False)
        hi = hit_rate(ps, invert=True)
        d = (hi or 0) - (hn or 0)
        print(f"   {name:<16}  {len(ps):>3}   {hn:>6}%     {hi:>6}%    {d:+6.1f}")

    # --- D) STRATIFICAZIONE PER |pred| (gating diretto) ---
    print(f"\nD) Stratificazione per |pred_forward_pp| (gating)")
    print(f"   bucket |pred|     n      hit%_norm   hit%_inv    delta   mean_pred  mean_actual")
    print(f"   --------------    ----   ---------   --------    -----   ---------  -----------")
    pred_buckets = [(0.0, 0.5), (0.5, 1.5), (1.5, 3.0), (3.0, 5.0), (5.0, 100.0)]
    for lo, hi_ in pred_buckets:
        ps = [(p, a) for p, a, _, _ in valid if lo <= abs(p) < hi_]
        if not ps:
            continue
        hn = hit_rate(ps, invert=False)
        hi_h = hit_rate(ps, invert=True)
        d = (hi_h or 0) - (hn or 0)
        mp = sum(p for p, _ in ps) / len(ps)
        ma = sum(a for _, a in ps) / len(ps)
        print(f"   [{lo:.1f},{hi_:.1f})         {len(ps):>4}   {hn:>6}%     {hi_h:>6}%    {d:+6.1f}    {mp:+7.2f}    {ma:+7.2f}")

    # --- E) BIAS GLOBALE pred vs actual ---
    print(f"\nE) Bias globale pred vs actual")
    mean_p = sum(p for p, _ in pairs) / n
    mean_a = sum(a for _, a in pairs) / n
    print(f"   mean(pred)   = {mean_p:+.3f}pp")
    print(f"   mean(actual) = {mean_a:+.3f}pp")
    print(f"   bias systematic = pred - actual = {mean_p - mean_a:+.3f}pp")
    n_up_pred = sum(1 for p, _ in pairs if p > BAND)
    n_dn_pred = sum(1 for p, _ in pairs if p < -BAND)
    n_up_act = sum(1 for _, a in pairs if a > BAND)
    n_dn_act = sum(1 for _, a in pairs if a < -BAND)
    print(f"   pred: {n_up_pred} UP ({100*n_up_pred/n:.1f}%) / {n_dn_pred} DOWN ({100*n_dn_pred/n:.1f}%)")
    print(f"   actu: {n_up_act} UP ({100*n_up_act/n:.1f}%) / {n_dn_act} DOWN ({100*n_dn_act/n:.1f}%)")
    ratio_pred = n_up_pred / max(n_dn_pred, 1)
    ratio_actu = n_up_act / max(n_dn_act, 1)
    print(f"   ratio UP/DOWN pred={ratio_pred:.2f}, actual={ratio_actu:.2f}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
