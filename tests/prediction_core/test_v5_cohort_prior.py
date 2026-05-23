"""NCT cohort prior for v5 PCG."""
from __future__ import annotations

from prediction.v5.cohort_prior import build_nct_cohort_mu, realized_pct_vs_m60_at_offset


def test_realized_from_curve_act_pct():
    row = {
        "curve_act_pct": {"-60": 0.0, "-30": 5.0, "-10": 8.0},
        "nct_relation_type": "direct sponsor",
    }
    assert realized_pct_vs_m60_at_offset(row, -30) == 5.0


def test_build_nct_cohort_mu_median():
    rows = {}
    for i in range(12):
        rows[f"TK{i}|2020-01-{i+1:02d}"] = {
            "nct_relation_type": "direct sponsor",
            "curve_act_pct": {"-60": 0.0, "-30": float(i), "-10": float(i) * 0.5},
        }
    mu = build_nct_cohort_mu(rows, min_members=8)
    assert mu is not None
    assert mu[-60] == 0.0
    assert 4.0 <= mu[-30] <= 6.0
