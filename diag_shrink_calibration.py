"""Measure (read-only) the MAE win of a magnitude 'shrink-to-mean' calibration.

Hypothesis from diag_other_cluster.py [6]: the model's predicted MAGNITUDE is
nearly uninformative about realized magnitude — E[|actual|] is ~flat across
|pred| buckets and the top bucket (|pred|>=15) over-predicts badly (realizes ~8
vs predicts ~21). So a monotone per-|pred|-tier magnitude calibration that keeps
the model's SIGN but rescales |pred| should cut MAE on the over-confident tail.

This script ONLY measures. It does not change the model or write any file.
It reports BASELINE vs calibrated MAE both in-sample and OUT-OF-SAMPLE
(chronological split + random k-fold), so the win is not overstated by overfit.

    .venv\\Scripts\\python.exe diag_shrink_calibration.py
"""
from __future__ import annotations

import random
from typing import Any

from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources

# |pred| tiers (absolute predicted magnitude, pp). Calibration is fit per tier.
PRED_TIERS = [(0.0, 3.0), (3.0, 6.0), (6.0, 10.0), (10.0, 15.0), (15.0, 1e9)]
MULT_GRID = [round(0.20 + 0.05 * i, 2) for i in range(0, 57)]  # 0.20 .. 3.00
MULT_CLAMP = (0.30, 3.00)


def _tier_idx(pred: float) -> int:
    a = abs(pred)
    for i, (lo, hi) in enumerate(PRED_TIERS):
        if lo <= a < hi:
            return i
    return len(PRED_TIERS) - 1


def _mae(rows: list[tuple[float, float]], mult_by_tier: list[float]) -> float:
    if not rows:
        return float("nan")
    tot = 0.0
    for p, a in rows:
        tot += abs(mult_by_tier[_tier_idx(p)] * p - a)
    return tot / len(rows)


def _fit_tier_mults(train: list[tuple[float, float]]) -> list[float]:
    """MAE-optimal multiplier per |pred| tier (grid search), clamped."""
    mults: list[float] = []
    for i in range(len(PRED_TIERS)):
        seg = [(p, a) for p, a in train if _tier_idx(p) == i]
        if len(seg) < 20:
            mults.append(1.0)  # too few to calibrate -> identity
            continue
        best_m, best_e = 1.0, float("inf")
        for m in MULT_GRID:
            e = sum(abs(m * p - a) for p, a in seg) / len(seg)
            if e < best_e:
                best_e, best_m = e, m
        mults.append(min(MULT_CLAMP[1], max(MULT_CLAMP[0], best_m)))
    return mults


def _fit_global_mult(train: list[tuple[float, float]]) -> float:
    best_m, best_e = 1.0, float("inf")
    for m in MULT_GRID:
        e = sum(abs(m * p - a) for p, a in train) / len(train)
        if e < best_e:
            best_e, best_m = e, m
    return min(MULT_CLAMP[1], max(MULT_CLAMP[0], best_m))


def _pairs(rows: list[dict[str, Any]]) -> list[tuple[float, float, str]]:
    out = []
    for r in rows:
        if r.get("pred") is None or r.get("actual") is None:
            continue
        out.append((float(r["pred"]), float(r["actual"]), str(r.get("date") or "")[:10]))
    return out


def _report_split(name: str, train: list[tuple[float, float]], test: list[tuple[float, float]]) -> None:
    tier_m = _fit_tier_mults(train)
    glob_m = _fit_global_mult(train)
    ident = [1.0] * len(PRED_TIERS)
    base = _mae(test, ident)
    g = _mae(test, [glob_m] * len(PRED_TIERS))
    t = _mae(test, tier_m)
    print(f"\n--- {name}  (train n={len(train)}, test n={len(test)}) ---")
    print("  fitted tier multipliers: "
          + ", ".join(f"{lo:g}-{(hi if hi < 1e9 else 'inf')}:{m:.2f}"
                      for (lo, hi), m in zip(PRED_TIERS, tier_m)))
    print(f"  global multiplier fitted: {glob_m:.2f}")
    print(f"  TEST MAE  baseline={base:.3f}  global-mult={g:.3f} "
          f"({100*(g-base)/base:+.1f}%)  tier-shrink={t:.3f} ({100*(t-base)/base:+.1f}%)")
    # Per-tier breakdown on the TEST set.
    print(f"  {'|pred| tier':12s} {'n':>5s} {'mult':>5s} {'base_MAE':>9s} {'cal_MAE':>8s} {'delta%':>7s}")
    for i, (lo, hi) in enumerate(PRED_TIERS):
        seg = [(p, a) for p, a in test if _tier_idx(p) == i]
        if not seg:
            continue
        b = _mae(seg, ident)
        c = _mae(seg, tier_m)
        lab = f"{lo:g}-{(hi if hi < 1e9 else 'inf')}"
        print(f"  {lab:12s} {len(seg):5d} {tier_m[i]:5.2f} {b:9.3f} {c:8.3f} "
              f"{100*(c-b)/b:+7.1f}")


def _avg(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else float("nan")


def main() -> None:
    rows = _pairs(collect_resolved_outcomes_from_sources())
    print("=" * 78)
    print(f"MAGNITUDE SHRINK-TO-MEAN CALIBRATION — measurement only  (n={len(rows)})")
    print("=" * 78)
    if not rows:
        print("No resolved outcomes found (run on the machine that holds data/).")
        return
    print("Calibrated pred = tier_multiplier(|pred|) * pred  (SIGN preserved;")
    print("direction accuracy is therefore UNCHANGED — this only fixes magnitude).")

    # In-sample (upper bound on the win — overfit reference).
    allp = [(p, a) for p, a, _ in rows]
    _report_split("IN-SAMPLE (fit==eval, optimistic)", allp, allp)

    # Chronological split (deployment-realistic: fit past, test future).
    dated = sorted(rows, key=lambda r: r[2])
    cut = int(len(dated) * 0.7)
    tr = [(p, a) for p, a, _ in dated[:cut]]
    te = [(p, a) for p, a, _ in dated[cut:]]
    _report_split("OUT-OF-SAMPLE chronological 70/30", tr, te)

    # Random 5-fold CV (averages out a single unlucky split).
    rnd = random.Random(42)
    shuffled = allp[:]
    rnd.shuffle(shuffled)
    k = 5
    folds = [shuffled[i::k] for i in range(k)]
    base_acc, glob_acc, tier_acc = [], [], []
    for i in range(k):
        test = folds[i]
        train = [x for j in range(k) if j != i for x in folds[j]]
        tm = _fit_tier_mults(train)
        gm = _fit_global_mult(train)
        base_acc.append(_mae(test, [1.0] * len(PRED_TIERS)))
        glob_acc.append(_mae(test, [gm] * len(PRED_TIERS)))
        tier_acc.append(_mae(test, tm))
    b, gg, tt = _avg(base_acc), _avg(glob_acc), _avg(tier_acc)
    print("\n--- OUT-OF-SAMPLE random 5-fold CV (mean test MAE) ---")
    print(f"  baseline={b:.3f}  global-mult={gg:.3f} ({100*(gg-b)/b:+.1f}%)  "
          f"tier-shrink={tt:.3f} ({100*(tt-b)/b:+.1f}%)")

    print("\nReading: a NEGATIVE delta% on the out-of-sample rows = real MAE")
    print("reduction that would survive deployment. Watch the |pred|>=15 tier —")
    print("that is where the over-confidence lives and where the win should concentrate.")


if __name__ == "__main__":
    main()
