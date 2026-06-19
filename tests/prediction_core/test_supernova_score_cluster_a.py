"""Cluster A scoring — phase, endpoint, unmet need, market size."""
from __future__ import annotations

from prediction.supernova_score import (
    SdsTickerInput,
    compute_cluster_a,
    compute_sds,
    endpoint_credibility_detail,
    market_size_detail,
    phase_credibility_detail,
    unmet_need_score,
)


def test_phase_credibility_phase3_with_bonuses():
    d = phase_credibility_detail(
        "PHASE3",
        "randomized double blind placebo-controlled",
        "Histological improvement on liver biopsy",
        primary_outcomes=["Biopsy score", "Fibrosis stage"],
    )
    assert d["score"] >= 10.0
    assert d["phase_detected"] in ("Phase 3", "Phase 3 pivotal")
    assert "placebo_controlled" in d["bonuses"]


def test_phase_credibility_missing_phase():
    d = phase_credibility_detail(None, "randomized")
    assert d["score"] == 0.0
    assert "phase_data_missing" in d["flags"]


def test_endpoint_pfs_keyword():
    d = endpoint_credibility_detail("Progression-free survival (PFS) per RECIST 1.1")
    assert d["score"] == 8.0
    assert d["endpoint_type"] == "PFS/EFS"
    assert d["keyword_matched"] == "progression-free survival"


def test_endpoint_inferred_default():
    d = endpoint_credibility_detail(None, None)
    assert d["score"] == 3.0
    assert "endpoint_inferred" in d["flags"]


def test_unmet_need_tiers_and_fic_bonus():
    assert unmet_need_score(0, True, confidence="high") == 13.0
    assert unmet_need_score(2, False) == 7.0
    assert unmet_need_score(4, False) == 4.0
    assert unmet_need_score(10, False) == 1.0


def test_market_size_nash_lookup():
    d = market_size_detail("Non-alcoholic steatohepatitis (NASH)")
    assert d["tam_estimate_bn"] == 8.0
    assert d["score"] == 8.0
    assert d["source"] == "lookup_table"


def test_market_size_unknown_default():
    d = market_size_detail("Rare orphan lysosomal disorder XYZ")
    assert d["score"] == 3.0
    assert "market_size_estimated" in d["flags"]


def test_mdgl_like_cluster_a_raw():
    """MDGL-style: NASH Phase 3, histology endpoint, crowded market but large TAM."""
    inp = SdsTickerInput(
        ticker="MDGL",
        closes=[10.0] * 130,
        volumes=[1_000_000.0] * 130,
        xbi_closes=[10.0] * 130,
        phase="Phase 3",
        trial_design="randomized double blind placebo-controlled",
        primary_outcome="NASH resolution with no worsening of fibrosis on liver biopsy",
        primary_outcomes=["NASH resolution", "Fibrosis stage"],
        indication="Non-alcoholic steatohepatitis",
        condition="Non-alcoholic steatohepatitis",
        approved_drugs_count=2,
        first_in_class=True,
        first_in_class_confidence="high",
        cash_runway_months=24.0,
        market_regime="NEUTRAL",
        days_to_cd=120,
    )
    raw, breakdown = compute_cluster_a(inp)
    assert raw > 35.0, f"expected cluster_A raw > 35, got {raw} breakdown={breakdown}"


def test_acrs_like_cluster_a_raw():
    """ACRS-style: RA Phase 2a, novel mechanism proxy via first-in-class."""
    inp = SdsTickerInput(
        ticker="ACRS",
        closes=[10.0] * 130,
        volumes=[1_000_000.0] * 130,
        xbi_closes=[10.0] * 130,
        phase="Phase 2a",
        trial_design="randomized double blind placebo-controlled",
        primary_outcome="ACR20 response rate at week 12",
        indication="Rheumatoid Arthritis",
        condition="Rheumatoid Arthritis",
        approved_drugs_count=3,
        first_in_class=True,
        first_in_class_confidence="high",
        cash_runway_months=18.0,
        market_regime="NEUTRAL",
        days_to_cd=90,
    )
    raw, _ = compute_cluster_a(inp)
    assert raw > 25.0


def test_phase1_low_cluster_a():
    inp = SdsTickerInput(
        ticker="EARLY",
        closes=[10.0] * 130,
        volumes=[1_000_000.0] * 130,
        xbi_closes=[10.0] * 130,
        phase="Phase 1",
        primary_outcome="Safety and tolerability",
        indication="Rare disease XYZ",
        approved_drugs_count=None,
        cash_runway_months=12.0,
        market_regime="NEUTRAL",
    )
    raw, _ = compute_cluster_a(inp)
    assert raw < 15.0


def test_compute_sds_includes_cluster_a_breakdown():
    inp = SdsTickerInput(
        ticker="TEST",
        closes=[10.0 + i * 0.01 for i in range(130)],
        volumes=[1_000_000.0] * 130,
        xbi_closes=[10.0] * 130,
        phase="Phase 3",
        primary_outcome="Overall survival",
        trial_design="randomized placebo-controlled",
        indication="Lung cancer",
        approved_drugs_count=2,
        cash_runway_months=18.0,
        market_regime="NEUTRAL",
        days_to_cd=45,
    )
    res = compute_sds(inp)
    assert res.cluster_a
    assert res.cluster_a["phase_credibility"]["score"] >= 7.0
    assert res.cluster_a["endpoint_credibility"]["score"] == 10.0
