"""Tests for the rule-driven SELL/exit decision."""
from __future__ import annotations

from prediction.sds_investment_decision import classify_exit_reason, sell_decision


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
