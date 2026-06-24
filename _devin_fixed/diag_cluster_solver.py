"""Diagnostic: per-cluster magnitude ratios, to tune the cal_factor solver.

Run from the repo root:  python _devin_fixed/diag_cluster_solver.py

It mirrors compute_cluster_cal_factors' pair-building exactly, then prints, per
cluster: n, bias, mae, direction accuracy, the raw OLS magnitude ratio
m = sum(p*a)/sum(p^2) WITHOUT trimming and WITH the |actual|<=50pp trim, and the
shrunk-toward-1.0 factor (clipped to 0.7..1.3) for several shrink strengths k.
This shows whether the tail-trim flips the signal and which k keeps cohorts off
the rails. Nothing is written.
"""
from __future__ import annotations

from prediction.cluster_cal_factor import (
    CLUSTER_CF_CEILING,
    CLUSTER_CF_FLOOR,
    CLUSTER_MIN_SAMPLES,
    TICKER_CLUSTERS,
    classify_ticker,
    collect_resolved_outcomes_from_sources,
)


def _ols(pairs: list[tuple[float, float]]) -> float | None:
    den = sum(p * p for p, _ in pairs)
    if den <= 1e-9:
        return None
    return sum(p * a for p, a in pairs) / den


def _shrunk_clipped(m_ols: float | None, k: float) -> float | None:
    if m_ols is None:
        return None
    m = (m_ols + k) / (1.0 + k)
    return max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, m))


def main() -> int:
    outcomes = collect_resolved_outcomes_from_sources()
    buckets: dict[str, list[dict]] = {}
    for o in outcomes:
        td = o.get("ticker_data") or {"phase": o.get("phase", ""), "condition": o.get("condition", "")}
        buckets.setdefault(classify_ticker(td), []).append(o)

    ks = (2.0, 4.0, 6.0, 9.0)
    header = (
        f"{'cluster':18} {'n':>4} {'bias':>6} {'mae':>6} {'dir':>5} "
        f"{'m_raw':>6} {'m_trim50':>8}  " + "  ".join(f"k={int(k)}".rjust(6) for k in ks)
    )
    print(header)
    print("-" * len(header))
    for name in list(TICKER_CLUSTERS.keys()) + ["other"]:
        errs = buckets.get(name, [])
        if len(errs) < CLUSTER_MIN_SAMPLES:
            print(f"{name:18} {len(errs):>4}  (insufficient_data)")
            continue
        pairs = [
            (float(e["pred"]), float(e["actual"]))
            for e in errs
            if e.get("pred") is not None and e.get("actual") is not None
        ]
        if not pairs:
            print(f"{name:18} {len(errs):>4}  (no pairs)")
            continue
        bias = sum(p - a for p, a in pairs) / len(pairs)
        mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
        dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)
        m_raw = _ols(pairs)
        m_trim = _ols([(p, a) for p, a in pairs if abs(a) <= 50.0])
        kcols = "  ".join(
            (f"{_shrunk_clipped(m_raw, k):.3f}".rjust(6) if m_raw is not None else "  -".rjust(6))
            for k in ks
        )
        print(
            f"{name:18} {len(pairs):>4} {bias:>6.2f} {mae:>6.2f} {dir_acc:>5.2f} "
            f"{(m_raw if m_raw is not None else float('nan')):>6.2f} "
            f"{(m_trim if m_trim is not None else float('nan')):>8.2f}  {kcols}"
        )
    print("\nNote: k columns use the RAW (untrimmed) OLS shrunk toward 1.0, clipped to 0.7..1.3.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
