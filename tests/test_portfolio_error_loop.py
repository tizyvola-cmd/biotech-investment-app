"""Tests for portfolio_error_loop (Phase 3)."""

from __future__ import annotations

from prediction.portfolio_error_loop import (
    DEFAULT_PARAMS,
    _counterfactual_pnl,
    _deal_score,
    preview_cycle,
    reset_calibration,
)


def test_deal_score_positive():
    row = {"affidabilita_pct": 72, "pred7_pp": 8.0}
    sc = _deal_score(row, DEFAULT_PARAMS)
    assert sc > 0


def test_counterfactual_modes():
    rows = [
        {"capital_eur": 1000, "pnl_pct": 10.0, "affidabilita_pct": 80, "pred7_pp": 5},
        {"capital_eur": 1000, "pnl_pct": -5.0, "affidabilita_pct": 55, "pred7_pp": 3},
    ]
    mine = _counterfactual_pnl(rows, "mine", DEFAULT_PARAMS)
    equal = _counterfactual_pnl(rows, "equal", DEFAULT_PARAMS)
    weighted = _counterfactual_pnl(rows, "weighted", DEFAULT_PARAMS)
    assert mine == 50.0  # 1000*10% + 1000*-5%
    assert equal is not None and weighted is not None


def test_preview_cycle_runs():
    doc = preview_cycle()
    assert doc.get("dry_run") is True
    assert "snapshot" in doc


def test_reset_requires_confirm():
    assert reset_calibration(confirm=False).get("ok") is False
