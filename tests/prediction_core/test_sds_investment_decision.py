"""Tests for the rule-driven SELL/exit decision."""
from __future__ import annotations

from prediction.sds_investment_decision import (
    classify_exit_reason,
    investment_decision,
    pred_reliability_weight,
    sell_decision,
)
from prediction.supernova_score import SdsResult, SdsTickerInput


def test_sell_stop_loss_fires_first():
    d = sell_decision(pnl_pct=-20.0, sds_live=70.0, days_to_cd=30)
    assert d is not None
    assert d["action"] == "SELL"
    assert d["exit_reason"] == "stop_loss"


def test_sell_sds_deterioration():
    d = sell_decision(pnl_pct=-5.0, sds_live=35.0, days_to_cd=30)
    assert d is not None and d["exit_reason"] == "sds_below_40"


def test_sell_pre_cd_window():
    assert sell_decision(pnl_pct=4.0, sds_live=80.0, days_to_cd=2)["exit_reason"] == "pre_cd_exit"
    # outside T-3..T-1 window -> no trigger
    assert sell_decision(pnl_pct=4.0, sds_live=80.0, days_to_cd=10) is None


def test_no_trigger_returns_none():
    assert sell_decision(pnl_pct=3.0, sds_live=70.0, days_to_cd=30) is None


def test_classify_exit_reason_defaults_to_capital_removed():
    assert classify_exit_reason(pnl_pct=3.0, sds_live=70.0, days_to_cd=30) == "capital_removed"
    assert classify_exit_reason(pnl_pct=-18.0, sds_live=70.0, days_to_cd=30) == "stop_loss"


def test_priority_order_stop_loss_over_sds():
    # both stop-loss and SDS deterioration hold -> stop_loss wins (checked first)
    assert classify_exit_reason(pnl_pct=-30.0, sds_live=10.0, days_to_cd=2) == "stop_loss"


def test_pred_reliability_weight_linear_with_50pct_cutoff():
    assert pred_reliability_weight(100.0) == 1.0
    assert pred_reliability_weight(75.0) == 0.5
    assert pred_reliability_weight(50.0) == 0.0
    assert pred_reliability_weight(40.0) == 0.0  # below coin-flip -> clamped to 0
    assert pred_reliability_weight(None) == 1.0  # missing -> neutral, no penalty


def _entry_setup():
    inp = SdsTickerInput(
        ticker="AAA",
        days_to_cd=30,
        pred5_live=6.0,
        confidence_score=0.9,
        market_regime="NEUTRAL",
    )
    sds = SdsResult(
        ticker="AAA",
        sds=60.0,
        zone_label="CANDIDATE",
        zone_color="",
        zone_action="",
        veto=None,
    )
    return inp, sds


def test_reliable_window_keeps_prediction_full():
    inp, sds = _entry_setup()
    out = investment_decision(inp, sds, reliability_pct=100.0)
    assert out["action"] == "ENTRY"
    assert out["pred_effective"] == 6.0


def test_low_reliability_window_discounts_prediction_to_hold():
    inp, sds = _entry_setup()
    # R=60 -> w=0.2 -> pred_eff=1.2 < 3.0 -> HOLD (pred alignment)
    out = investment_decision(inp, sds, reliability_pct=60.0)
    assert out["action"] == "HOLD"
    assert out["label"] == "PRED ALIGNMENT"
    assert out["pred_effective"] == 1.2
