"""Diagnostic: per-cluster magnitude signal, to preview the cal_factor solver.

Run from the repo root:  python _devin_fixed/diag_cluster_solver.py

It mirrors compute_cluster_cal_factors' pair-building exactly, then prints, per
cluster: n, bias, mae, direction accuracy, the raw OLS magnitude ratio
m = sum(p*a)/sum(p^2), the variance explained rho2 = (sum p*a)^2/(sum p^2 * sum a^2),
and the new confidence-weighted cal_factor cal = 1 + rho2*(clip(m_ols)-1), clipped
to 0.7..1.3 -- exactly what the fixed solver produces. rho2 ~ 0 means the cohort
carries no magnitude signal, so cal stays at 1.0 (no forced/false correction).
Nothing is written.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prediction.cluster_cal_factor import (  # noqa: E402
    CLUSTER_CF_CEILING,
    CLUSTER_CF_FLOOR,
    CLUSTER_MIN_SAMPLES,
    TICKER_CLUSTERS,
    classify_ticker,
    collect_resolved_outcomes_from_sources,
)


def _signal(pairs: list[tuple[float, float]]) -> tuple[float | None, float | None, float | None]:
    """Return (m_ols, rho2, cal_new) for the confidence-weighted solver."""
    sp2 = sum(p * p for p, _ in pairs)
    sa2 = sum(a * a for _, a in pairs)
    if sp2 <= 1e-9 or sa2 <= 1e-9:
        return None, None, None
    spa = sum(p * a for p, a in pairs)
    m_ols = spa / sp2
    rho2 = (spa * spa) / (sp2 * sa2)
    m_clipped = max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, m_ols))
    cal = 1.0 + rho2 * (m_clipped - 1.0)
    cal = max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, cal))
    return m_ols, rho2, cal


def main() -> int:
    outcomes = collect_resolved_outcomes_from_sources()
    buckets: dict[str, list[dict]] = {}
    for o in outcomes:
        td = o.get("ticker_data") or {"phase": o.get("phase", ""), "condition": o.get("condition", "")}
        buckets.setdefault(classify_ticker(td), []).append(o)

    header = (
        f"{'cluster':18} {'n':>4} {'bias':>6} {'mae':>6} {'dir':>5} "
        f"{'m_ols':>6} {'rho2':>6} {'cal_new':>8}"
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
        m_ols, rho2, cal = _signal(pairs)
        if m_ols is None:
            print(f"{name:18} {len(pairs):>4}  (degenerate)")
            continue
        print(
            f"{name:18} {len(pairs):>4} {bias:>6.2f} {mae:>6.2f} {dir_acc:>5.2f} "
            f"{m_ols:>6.2f} {rho2:>6.3f} {cal:>8.3f}"
        )
    print(
        "\nNote: cal_new = 1 + rho2*(clip(m_ols)-1), clipped to 0.7..1.3 "
        "(the fixed solver). rho2 ~ 0 => no magnitude signal => cal stays 1.0."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
