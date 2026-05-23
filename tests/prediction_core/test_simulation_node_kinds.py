"""Simulation sheet: nodi Pred storici (close) vs ricalibrati."""
from __future__ import annotations

from datetime import date, timedelta

from prediction.live_recalib_sheet import simulation_pred_node_kinds


def test_future_offset_is_recalibrated():
    _today = date.today()
    _cd = _today + timedelta(days=90)
    kinds = simulation_pred_node_kinds(
        {"ticker": "TST"},
        {"ticker": "TST", "model_dm60_pct": 0.0, "model_d7_pct": 1.0},
        _cd,
        [0.0, None, None, None, None, None, 2.0, 3.0],
        today=_today,
        ser_cache={},
    )
    assert kinds[0] == "recalibrated"  # T-60 not reached yet vs CD far future
    assert kinds[-1] == "recalibrated"


def test_t60_baseline_historical_when_p60_known():
    _today = date.today()
    _cd = _today + timedelta(days=30)
    kinds = simulation_pred_node_kinds(
        {"ticker": "TST"},
        {"ticker": "TST", "seq_curve_t60_usd": 10.0},
        _cd,
        [0.0] + [None] * 7,
        today=_today,
        ser_cache={},
    )
    assert kinds[0] == "historical"
