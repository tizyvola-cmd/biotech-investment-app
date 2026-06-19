"""Tests for Supernova composite scoring engine."""
from __future__ import annotations

import math

import pytest

from prediction.scoring_engine import (
    ScoringInput,
    WEIGHTS,
    compute_component_scores,
    score_stock,
)
from prediction.technicals import bollinger_bands, rsi14, sma, slope_pct


def _uptrend_closes(n: int = 60, start: float = 10.0, daily: float = 0.003) -> list[float]:
    out = [start]
    for _ in range(n - 1):
        out.append(out[-1] * (1 + daily))
    return out


def _downtrend_closes(n: int = 60, start: float = 20.0, daily: float = -0.004) -> list[float]:
    out = [start]
    for _ in range(n - 1):
        out.append(out[-1] * (1 + daily))
    return out


def test_technicals_sma_rsi():
    closes = _uptrend_closes(60)
    assert sma(closes, 20) is not None
    assert sma(closes, 20) < closes[-1]
    r = rsi14(closes)
    assert r is not None and r > 50


def test_momentum_score_uptrend_positive():
    closes = _uptrend_closes(60)
    comps = compute_component_scores(ScoringInput(closes=closes))
    assert comps["momentum"] is not None
    assert comps["momentum"] > 0


def test_momentum_score_downtrend_negative():
    closes = _downtrend_closes(60)
    comps = compute_component_scores(ScoringInput(closes=closes))
    assert comps["momentum"] is not None
    assert comps["momentum"] < 0


def test_deceleration_volume_yellow_component():
    closes = _uptrend_closes(60, daily=0.001)
    # flatten last 5 days
    for i in range(-5, 0):
        closes[i] = closes[-6]
    vols = [1_000_000.0] * 55 + [800_000.0] * 5
    comps = compute_component_scores(ScoringInput(closes=closes, volumes=vols))
    assert comps["slope"] is not None


def test_rsi_oversold_bullish():
    closes = _downtrend_closes(30, start=50, daily=-0.015)
    comps = compute_component_scores(ScoringInput(closes=closes))
    assert comps["rsi"] is not None
    assert comps["rsi"] > 0


def test_rsi_overbought_bearish():
    closes = _uptrend_closes(30, start=10, daily=0.025)
    comps = compute_component_scores(ScoringInput(closes=closes))
    assert comps["rsi"] is not None
    assert comps["rsi"] < 0


def test_cash_runway_crisis_override():
    closes = _uptrend_closes(60)
    result = score_stock(
        "HURA",
        ScoringInput(closes=closes, cash_runway_months=2.0, catalyst_days_to_event=120),
    )
    assert result.override_flag == "CASH CRISIS"
    assert result.recommendation in ("SELL", "STRONG SELL")


def test_pre_catalyst_lock_override():
    closes = _uptrend_closes(60)
    result = score_stock(
        "TLX",
        ScoringInput(closes=closes, catalyst_days_to_event=10, cash_runway_months=24),
    )
    assert result.override_flag == "PRE-CATALYST LOCK"
    assert result.recommendation == "HOLD"


def test_post_event_dislocation_override():
    closes = _downtrend_closes(30, start=15, daily=-0.01)
    vols = [500_000.0] * 19 + [2_000_000.0]
    result = score_stock(
        "BCAB",
        ScoringInput(
            closes=closes,
            volumes=vols,
            price_drop_48h_pct=-25,
            cash_runway_months=12,
            catalyst_days_to_event=200,
        ),
    )
    assert result.override_flag == "POST-EVENT DISLOCATION"


def test_missing_data_redistributes_weight():
    closes = _uptrend_closes(60)
    full = score_stock("OLMA", ScoringInput(closes=closes, beta=1.2, catalyst_days_to_event=45))
    sparse = score_stock("OLMA", ScoringInput(closes=closes))
    assert full.confidence_score > sparse.confidence_score
    assert -100 <= full.composite_score <= 100


def test_recommendation_thresholds():
    closes = _uptrend_closes(60, daily=0.008)
    vols = [500_000.0] * 19 + [1_500_000.0]
    result = score_stock(
        "BNTX",
        ScoringInput(
            closes=closes,
            volumes=vols,
            beta=1.1,
            catalyst_days_to_event=20,
            cash_runway_months=30,
            clinical_phase_num=3,
            xbi_closes=_uptrend_closes(60, start=80, daily=0.002),
        ),
    )
    assert result.recommendation in ("STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL")
    assert "hex" in result.color
    assert result.color["tailwind_bg"]


def test_weights_sum_to_one():
    assert math.isclose(sum(WEIGHTS.values()), 1.0, rel_tol=1e-6)


def test_bollinger_squeeze():
    closes = [10.0] * 19 + [10.05]
    _, _, _, w = bollinger_bands(closes, 20)
    assert w is not None and w < 0.05


def test_short_interest_squeeze_signal():
    closes = _uptrend_closes(60)
    comps = compute_component_scores(
        ScoringInput(closes=closes, short_interest_pct=25, days_to_cover=6, catalyst_days_to_event=60)
    )
    assert comps["short_interest"] is not None
    assert comps["short_interest"] > 0
