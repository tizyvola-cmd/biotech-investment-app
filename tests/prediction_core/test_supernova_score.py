"""Tests for Supernova Distance Score (SDS)."""
from __future__ import annotations

from prediction.supernova_score import SdsTickerInput, compute_sds


def _sample_closes(n: int = 130, *, flat: bool = False) -> list[float]:
    if flat:
        return [10.0 + (i % 3) * 0.02 for i in range(n)]
    return [10.0 + i * 0.05 + (i % 7) * 0.1 for i in range(n)]


def test_sds_timing_cluster_elevates_in_window():
    inp = SdsTickerInput(
        ticker="TEST",
        closes=_sample_closes(),
        volumes=[1_000_000.0] * 130,
        xbi_closes=_sample_closes(flat=True),
        days_to_cd=30,
        phase="Phase 3",
        cash_runway_months=12.0,
        market_regime="NEUTRAL",
        catalyst_types_90d=["clinical_readout"],
    )
    res = compute_sds(inp)
    assert res.sds >= 0
    assert res.cluster_scores.get("timing", 0) >= 5.0
    assert res.veto is None


def test_sds_cash_crisis_veto():
    inp = SdsTickerInput(
        ticker="Broke",
        closes=_sample_closes(),
        cash_runway_months=2.0,
        days_to_cd=30,
        market_regime="NEUTRAL",
    )
    res = compute_sds(inp)
    assert res.sds == 0.0
    assert res.veto == "CASH_CRISIS"


def test_sds_binary_event_lock():
    inp = SdsTickerInput(
        ticker="SOON",
        closes=_sample_closes(),
        days_to_cd=5,
        cash_runway_months=18.0,
        market_regime="NEUTRAL",
        phase="Phase 2",
    )
    res = compute_sds(inp)
    assert res.veto == "BINARY_EVENT_LOCK"
