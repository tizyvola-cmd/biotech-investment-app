"""Tests for validation feedback loop cal_factor proposals."""
from __future__ import annotations

import pytest

from prediction.validation_feedback_loop import (
    THRESHOLDS,
    _propose_cal_changes,
    build_portfolio_summary,
    compute_ticker_performance,
)


def test_compute_ticker_performance_empty():
    perf = compute_ticker_performance([], today=None)
    assert perf == {}


def test_underperformer_reduces_cal_factor():
    perf = {
        "BAD": {
            "persistent_mae": 12.0,
            "direction_acc": 0.4,
            "bias": 2.0,
            "n_nodes": 6,
            "flag": "ok",
        },
        "OK1": {
            "persistent_mae": 2.0,
            "direction_acc": 0.55,
            "bias": 0.5,
            "n_nodes": 6,
            "flag": "ok",
        },
        "OK2": {
            "persistent_mae": 2.0,
            "direction_acc": 0.5,
            "bias": 0.0,
            "n_nodes": 6,
            "flag": "ok",
        },
    }
    seq_doc = {"events": {"e1": {"ticker": "BAD", "cal_factor": 1.0}}}
    changes, flags = _propose_cal_changes(perf, seq_doc)
    assert "BAD" in flags["underperformers"]
    assert perf["BAD"]["cal_factor"] == pytest.approx(0.95)
    assert len(changes) == 1
    assert changes[0]["old_cal"] == 1.0
    assert changes[0]["new_cal"] == pytest.approx(0.95)


def test_strong_performer_increases_cal_factor():
    perf = {
        "GOOD": {
            "persistent_mae": 0.8,
            "direction_acc": 0.7,
            "bias": -0.2,
            "n_nodes": 6,
            "flag": "ok",
        },
        "MID": {
            "persistent_mae": 3.0,
            "direction_acc": 0.5,
            "bias": 0.0,
            "n_nodes": 6,
            "flag": "ok",
        },
    }
    seq_doc = {"events": {"e1": {"ticker": "GOOD", "cal_factor": 1.0}}}
    changes, flags = _propose_cal_changes(perf, seq_doc)
    assert "GOOD" in flags["strong_performers"]
    assert perf["GOOD"]["cal_factor"] == pytest.approx(1.03)


def test_cal_factor_floor():
    perf = {
        "BAD": {
            "persistent_mae": 20.0,
            "direction_acc": 0.2,
            "bias": 5.0,
            "n_nodes": 6,
            "flag": "ok",
        },
        "X": {"persistent_mae": 2.0, "direction_acc": 0.5, "bias": 0, "n_nodes": 6, "flag": "ok"},
    }
    seq_doc = {"events": {"e1": {"ticker": "BAD", "cal_factor": THRESHOLDS["cal_factor_floor"]}}}
    _propose_cal_changes(perf, seq_doc)
    assert perf["BAD"]["cal_factor"] == THRESHOLDS["cal_factor_floor"]


def test_portfolio_summary():
    perf = {"A": {"persistent_mae": 2.0, "direction_acc": 0.6, "flag": "ok"}}
    summary = build_portfolio_summary(
        perf,
        [],
        {"underperformers": [], "strong_performers": [], "bias_flags": [], "direction_suspended": []},
    )
    assert summary["portfolio_avg_mae"] == pytest.approx(2.0)
