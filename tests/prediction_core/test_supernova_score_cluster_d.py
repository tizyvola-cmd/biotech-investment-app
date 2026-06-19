"""Cluster D (fundamentals) component tests."""
from __future__ import annotations

from prediction.supernova_score import (
    SdsTickerInput,
    cash_runway_detail,
    compute_cluster_d,
    ma_attractiveness_detail,
    mc_pipeline_ratio_detail,
)


def test_cash_runway_safe_and_veto():
    safe = cash_runway_detail(18.0, meta={"total_cash": 200e6, "net_burn_monthly": 10e6})
    assert safe["score"] == 7.0
    assert safe["status"] == "safe"
    assert safe["veto_triggered"] is False

    danger = cash_runway_detail(2.0, meta={"total_cash": 20e6, "net_burn_monthly": 10e6})
    assert danger["score"] == -8.0
    assert danger["veto_triggered"] is True
    assert danger["status"] == "danger"

    cf_pos = cash_runway_detail(999.0)
    assert cf_pos["score"] == 8.0


def test_cash_runway_unavailable_neutral():
    d = cash_runway_detail(None, meta={"runway_status": "cash_data_unavailable"})
    assert d["score"] == 3.0
    assert d["veto_triggered"] is False
    assert d["status"] == "cash_data_unavailable"


def test_mc_pipeline_undervalued():
    d = mc_pipeline_ratio_detail(
        500_000_000,
        "nash",
        phase_probability=0.65,
        tam_billions=8.0,
    )
    assert d["status"] == "ok"
    assert d["ratio"] is not None
    assert d["ratio"] < 0.5
    assert d["score"] >= 6.0
    assert d["interpretation"] == "undervalued"


def test_ma_attractiveness_rules():
    d = ma_attractiveness_detail(
        first_in_class=True,
        condition="non-alcoholic steatohepatitis",
        phase="Phase 3 pivotal",
        market_cap=1_500_000_000,
        momentum_positive=True,
        tam_billions=8.0,
    )
    assert d["score"] >= 5.0
    assert "first_in_class_large_market" in d["rules_fired"]
    assert "phase3_momentum" in d["rules_fired"]
    assert d["potential_acquirers"]


def test_compute_cluster_d_integration():
    raw, bd = compute_cluster_d(
        SdsTickerInput(
            ticker="TEST",
            closes=[10.0 + i * 0.1 for i in range(130)],
            market_cap=800_000_000,
            cash_runway_months=15.0,
            phase="Phase 3",
            condition="lung cancer",
            first_in_class=True,
            phase_probability=0.65,
            cluster_d_meta={"total_cash": 150e6, "net_burn_monthly": 10e6},
        )
    )
    assert raw == (
        bd["cash_runway"]["score"]
        + bd["mc_pipeline_ratio"]["score"]
        + bd["ma_attractiveness"]["score"]
    )
    assert bd["total"] >= 0
    assert bd["cash_runway"]["status"] == "safe"
