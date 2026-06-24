"""Cluster B scoring — short, analyst, institutional delta."""
from __future__ import annotations

from prediction.supernova_score import (
    SdsTickerInput,
    analyst_upgrade_detail,
    compute_cluster_b,
    institutional_delta_detail,
    short_interest_detail,
)


def test_institutional_premium_fund_high_delta():
    d = institutional_delta_detail(8.0, premium_fund_present=True, premium_funds=["RA Capital Management"])
    assert d["score"] == 8.0


def test_institutional_exit():
    d = institutional_delta_detail(-8.0)
    assert d["score"] == -2.0


def test_cluster_b_weight_redistribution_without_short():
    inp = SdsTickerInput(
        ticker="X",
        closes=[10.0] * 30,
        short_interest_pct=None,
        days_to_cover=None,
        analyst_upgrade_score=4.0,
        institutional_delta_pct=5.0,
        cluster_b_meta={"inst_status": "ok"},
    )
    raw, br = compute_cluster_b(inp)
    assert br["short_interest"]["score"] is None
    assert br["weight_used"] == 16.0
    assert br["total"] > 0


def test_cluster_b_full_stack():
    inp = SdsTickerInput(
        ticker="KPTI",
        closes=[10.0 + i * 0.05 for i in range(30)],
        short_interest_pct=23.0,
        days_to_cover=6.0,
        analyst_upgrade_score=4.0,
        institutional_delta_pct=10.0,
        cluster_b_meta={
            "tier1_coverage": True,
            "premium_fund_present": True,
            "premium_funds_list": ["RA Capital Management"],
            "inst_status": "ok",
        },
    )
    raw, br = compute_cluster_b(inp)
    assert br["short_interest"]["squeeze_setup"] is True
    assert raw >= 10.0
    assert br["analyst_upgrades"]["score"] == 4.0


def test_analyst_detail_no_coverage():
    d = analyst_upgrade_detail(0.0, meta={"status": "no_recent_coverage", "downgrades_count": 0})
    assert d["score"] == 0.0
