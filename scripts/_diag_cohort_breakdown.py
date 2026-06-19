#!/usr/bin/env python3
"""Diagnostica profonda del cohort Decision Lab — perche` il modello e` sotto random?

Risponde a 3 domande:
  1) Distribuzione pred_dir x actual_dir (matrice di confusione 3x3)
  2) Distribuzione delle magnitudini di pred e actual (e quanti eventi sono "flat")
  3) Hit rate al variare di FLAT_BAND (0.5 / 1.0 / 1.5 / 2.0 / 3.0 pp)
     Se l'edge "compare" allargando la banda flat, il problema e` la zona-rumore;
     se Hit% resta sotto random anche con band larga, c'e` un bias sistematico.

Uso:
  python scripts/_diag_cohort_breakdown.py
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


def classify(v: float, band: float) -> str:
    if v > band:
        return "UP"
    if v < -band:
        return "DOWN"
    return "FLAT"


def hit_rate(rows: list[dict], band: float) -> tuple[int, int, float, dict]:
    """Ritorna (n_total, n_hit, hit_pct, confusion_matrix_3x3)."""
    confusion: dict[tuple[str, str], int] = Counter()
    n_total = 0
    n_hit = 0
    for r in rows:
        p = r.get("pred_forward_pp")
        a = r.get("realized_forward_pp")
        if p is None or a is None:
            continue
        pd_ = classify(float(p), band)
        ad_ = classify(float(a), band)
        confusion[(pd_, ad_)] += 1
        n_total += 1
        if pd_ == ad_:
            n_hit += 1
    pct = round(100.0 * n_hit / n_total, 1) if n_total else 0.0
    return n_total, n_hit, pct, confusion


def print_confusion(conf: dict, band: float, n_total: int) -> None:
    print(f"\n--- Matrice confusione (FLAT_BAND = +/-{band} pp) ---")
    print(f"             actual UP   actual FLAT  actual DOWN  | TOT")
    print(f"             ---------   -----------  -----------  +-----")
    for pd_ in ("UP", "FLAT", "DOWN"):
        row_tot = sum(conf.get((pd_, a), 0) for a in ("UP", "FLAT", "DOWN"))
        u = conf.get((pd_, "UP"), 0)
        f_ = conf.get((pd_, "FLAT"), 0)
        d = conf.get((pd_, "DOWN"), 0)
        marker = ""
        # Calcola precision direzionale (pred = X, actual = X) / (pred = X)
        if pd_ != "FLAT" and row_tot >= 5:
            prec = 100.0 * conf.get((pd_, pd_), 0) / row_tot
            marker = f"  -> precisione {prec:.1f}%"
        print(f"  pred {pd_:>4}   {u:>7}    {f_:>7}      {d:>7}      | {row_tot:>4}{marker}")
    # Totali per colonna
    print(f"             ---------   -----------  -----------  +-----")
    col_u = sum(conf.get((p, "UP"), 0) for p in ("UP", "FLAT", "DOWN"))
    col_f = sum(conf.get((p, "FLAT"), 0) for p in ("UP", "FLAT", "DOWN"))
    col_d = sum(conf.get((p, "DOWN"), 0) for p in ("UP", "FLAT", "DOWN"))
    print(f"  TOT          {col_u:>7}    {col_f:>7}      {col_d:>7}      | {n_total:>4}")


def magnitude_buckets(rows: list[dict]) -> None:
    """Distribuzione delle magnitudini di pred e actual."""
    bins = [0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 100.0]
    def bucket(v: float) -> str:
        a = abs(v)
        for i, b in enumerate(bins[1:]):
            if a < b:
                lo = bins[i]
                return f"[{lo:.1f},{b:.1f})"
        return "[10.0+)"

    pred_buckets: Counter = Counter()
    real_buckets: Counter = Counter()
    pred_zero = 0
    real_zero = 0
    for r in rows:
        p = r.get("pred_forward_pp")
        a = r.get("realized_forward_pp")
        if p is None or a is None:
            continue
        pred_buckets[bucket(float(p))] += 1
        real_buckets[bucket(float(a))] += 1
        if abs(float(p)) < 0.05:
            pred_zero += 1
        if abs(float(a)) < 0.05:
            real_zero += 1

    n = sum(pred_buckets.values())
    print(f"\n--- Distribuzione magnitudini |pred| vs |actual| (n={n}) ---")
    print(f"  pred  ~ 0   ({pred_zero:>3}, {100.0*pred_zero/n:.1f}%)  <-- 'predizioni piatte' sospette")
    print(f"  actual~ 0   ({real_zero:>3}, {100.0*real_zero/n:.1f}%)  <-- eventi con prezzo immobile")
    print()
    print(f"             |pred|              |actual|")
    print(f"             ------              ---------")
    keys = ["[0.0,0.5)", "[0.5,1.0)", "[1.0,2.0)", "[2.0,3.0)", "[3.0,5.0)", "[5.0,10.0)", "[10.0+)"]
    for k in keys:
        pn = pred_buckets.get(k, 0)
        rn = real_buckets.get(k, 0)
        pp = 100.0 * pn / n if n else 0
        rp = 100.0 * rn / n if n else 0
        print(f"  {k:<14}{pn:>3} ({pp:5.1f}%)     {rn:>3} ({rp:5.1f}%)")


def hit_when_actual_big(rows: list[dict], band_pred: float, big_thr: float) -> None:
    """Quando il movimento reale e` 'grosso' (|actual| >= big_thr), quanto azzecca il segno?"""
    big_rows = [r for r in rows
                if r.get("pred_forward_pp") is not None
                and r.get("realized_forward_pp") is not None
                and abs(float(r["realized_forward_pp"])) >= big_thr]
    if not big_rows:
        print(f"\n[ANOMALIA] Nessun evento con |actual| >= {big_thr}pp")
        return
    n = len(big_rows)
    hit_sign = sum(1 for r in big_rows
                   if (float(r["pred_forward_pp"]) > band_pred and float(r["realized_forward_pp"]) > 0)
                   or (float(r["pred_forward_pp"]) < -band_pred and float(r["realized_forward_pp"]) < 0))
    pred_neutral = sum(1 for r in big_rows if abs(float(r["pred_forward_pp"])) <= band_pred)
    print(f"\n--- Su eventi con |actual| >= {big_thr}pp (n={n}) ---")
    print(f"  Pred concorde col segno reale (|pred|>{band_pred}): {hit_sign} ({100.0*hit_sign/n:.1f}%)")
    print(f"  Pred NEUTRA (|pred|<={band_pred}):                   {pred_neutral} ({100.0*pred_neutral/n:.1f}%)  <-- modello 'non sa' su mosse forti")


def hit_by_band_sweep(rows: list[dict]) -> None:
    """Hit rate al variare di FLAT_BAND. Se sale con band larga -> rumore; se resta basso -> bias."""
    print(f"\n--- Sweep FLAT_BAND_PP (n_ic_pairs riferimento {sum(1 for r in rows if r.get('pred_forward_pp') is not None and r.get('realized_forward_pp') is not None)}) ---")
    print(f"  band (pp)     n_total   n_hit    hit%      note")
    print(f"  ----------    -------   -----    ----      ----")
    for band in (0.5, 1.0, 1.5, 2.0, 3.0, 5.0):
        n, h, pct, _ = hit_rate(rows, band)
        # Random baseline: con 3 classi non simmetriche serve calcolare
        # la baseline empirica (probabilita` che pred_dir == actual_dir
        # se fossero indipendenti = sum_x P(pred=x)*P(actual=x)).
        conf: Counter = Counter()
        for r in rows:
            p = r.get("pred_forward_pp")
            a = r.get("realized_forward_pp")
            if p is None or a is None:
                continue
            conf[("pred", classify(float(p), band))] += 1
            conf[("actual", classify(float(a), band))] += 1
        rand_base = 0.0
        if n > 0:
            for k in ("UP", "FLAT", "DOWN"):
                pp = conf.get(("pred", k), 0) / n
                pa = conf.get(("actual", k), 0) / n
                rand_base += pp * pa
            rand_base *= 100.0
        edge = pct - rand_base
        flag = "[OK edge>0]" if edge > 2 else "[debole]" if edge > -2 else "[sotto random]"
        print(f"  +/-{band:<7}   {n:>5}    {h:>5}    {pct:5.1f}%   random base={rand_base:.1f}%  edge={edge:+.1f}pp  {flag}")


def hit_by_pred_magnitude(rows: list[dict], band: float = 0.5) -> None:
    """Hit rate stratificato per |pred| (forse il modello sa solo quando dice 'molto')."""
    valid = [r for r in rows if r.get("pred_forward_pp") is not None and r.get("realized_forward_pp") is not None]
    if not valid:
        return
    bins = [(0.0, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 100.0)]
    print(f"\n--- Hit% stratificato per |pred| (band actual = +/-{band}pp) ---")
    print(f"  bucket |pred|     n       hit%     mean_pred   mean_actual")
    print(f"  ---------------   ----    ----     ---------   -----------")
    for lo, hi in bins:
        chunk = [r for r in valid if lo <= abs(float(r["pred_forward_pp"])) < hi]
        if not chunk:
            print(f"  [{lo:.1f},{hi:.1f})         0      n/d        n/d         n/d")
            continue
        n = len(chunk)
        n_hit = 0
        for r in chunk:
            p = float(r["pred_forward_pp"])
            a = float(r["realized_forward_pp"])
            if classify(p, band) == classify(a, band):
                n_hit += 1
        pct = 100.0 * n_hit / n
        mean_p = sum(float(r["pred_forward_pp"]) for r in chunk) / n
        mean_a = sum(float(r["realized_forward_pp"]) for r in chunk) / n
        print(f"  [{lo:.1f},{hi:.1f})        {n:>4}    {pct:5.1f}%   {mean_p:+7.2f}     {mean_a:+7.2f}")


def main() -> int:
    if not COHORT.is_file():
        print(f"[ERR] {COHORT} non trovato. Genera prima con investment_decision_cohort.py")
        return 1

    doc = json.loads(COHORT.read_text(encoding="utf-8"))
    rows: list[dict] = doc.get("rows", [])
    summary = doc.get("summary", {})

    print(f"=================================================================")
    print(f"  Diagnostica cohort Decision Lab — perche` Hit% globale e` basso?")
    print(f"=================================================================")
    print(f"  Generato:        {doc.get('generated_at')}")
    print(f"  N eventi tot:    {summary.get('n_events')}")
    print(f"  N IC pairs:      {summary.get('n_ic_pairs')}")
    print(f"  Hit% globale:    {summary.get('hit_rate_pct')}%  (FLAT_BAND_PP=0.5)")
    print(f"  IC Spearman:     {summary.get('ic_spearman')}")
    print(f"  mean_r_hold_pp:  {summary.get('mean_r_hold_pp')}")

    # 1) Matrice di confusione con band corrente
    _, _, _, conf = hit_rate(rows, 0.5)
    print_confusion(conf, 0.5, summary.get("n_ic_pairs") or 0)

    # 2) Magnitudini
    magnitude_buckets(rows)

    # 3) Sweep su band per capire se l'edge e` mascherato dalla zona-rumore
    hit_by_band_sweep(rows)

    # 4) Hit stratificato per |pred|
    hit_by_pred_magnitude(rows, band=0.5)

    # 5) Cosa succede quando l'actual e` "grosso"
    hit_when_actual_big(rows, band_pred=0.5, big_thr=2.0)
    hit_when_actual_big(rows, band_pred=0.5, big_thr=5.0)

    print(f"\n=================================================================")
    print(f"  Lettura risultati:")
    print(f"  - Se Hit% sale con band larga -> zona-rumore: rifinire FLAT_BAND a 1.0/1.5")
    print(f"  - Se Hit% pred grandi >> Hit% pred piccole -> usare gating su |pred|")
    print(f"  - Se molte 'pred ~ 0' -> bias_correction o engine pred sta saturando")
    print(f"  - Se mosse forti reali sono missate sistematicamente -> miscalibrazione di scala")
    print(f"=================================================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())
