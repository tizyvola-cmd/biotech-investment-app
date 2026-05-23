"""Tests per riconciliazione direzione ↔ curva precat."""
from __future__ import annotations

import pytest

from prediction.direction_ensemble import direction_ensemble_detail
from prediction.reconcile import (
    CurveAlignConfig,
    curve_direction_implied,
    reconcile_direction_and_curve,
)
from prediction.types import DirectionResult


def _bull_detail() -> DirectionResult:
    return direction_ensemble_detail(
        3,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=50,
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=3,
        slope_5d=1.0,
        slope_20d=0.8,
    )


def _ph2_detail() -> DirectionResult:
    return direction_ensemble_detail(
        2,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=50,
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=3,
        slope_5d=1.0,
        slope_20d=0.8,
    )


def test_bullish_direction_negative_curve_hybrid_scales():
    dr = _bull_detail()
    assert dr.direction_label.startswith("↑")
    pcts = {
        "model_dm60_pct": -4.0,
        "model_dm30_pct": -3.0,
        "model_dm10_pct": -2.0,
        "d30_pct": -1.0,
    }
    pol_before, _ = curve_direction_implied(pcts, epsilon=0.5)
    assert pol_before == "down"
    out = reconcile_direction_and_curve(
        dr,
        pcts,
        config=CurveAlignConfig(epsilon=0.5, mode="hybrid", strong_pp=10.0),
    )
    assert out.reconcile_action == "scale"
    assert out.model_pcts["model_dm60_pct"] is not None
    assert out.model_pcts["model_dm60_pct"] >= 0
    assert out.curve_direction_implied in ("up", "flat")
    assert out.direction_result.direction_label.startswith("↑")
    assert out.direction_curve_mismatch is not None


def test_consistent_bull_unchanged():
    dr = _bull_detail()
    pcts = {
        "model_dm60_pct": 5.0,
        "model_dm30_pct": 4.0,
        "model_dm10_pct": 3.0,
        "d30_pct": 2.0,
    }
    before = dict(pcts)
    out = reconcile_direction_and_curve(dr, pcts)
    assert out.direction_curve_aligned is True
    assert out.direction_curve_mismatch is None
    assert out.reconcile_action is None
    assert out.curve_direction_implied == "up"
    assert out.direction_result.direction_label == dr.direction_label
    assert pcts == before


def test_strong_mismatch_hybrid_downgrades():
    dr = _bull_detail()
    pcts = {
        "model_dm60_pct": -12.0,
        "model_dm30_pct": -10.0,
        "model_dm10_pct": -8.0,
        "d30_pct": -6.0,
    }
    out = reconcile_direction_and_curve(
        dr,
        pcts,
        config=CurveAlignConfig(epsilon=0.5, mode="hybrid", strong_pp=5.0),
    )
    assert out.reconcile_action == "downgrade"
    assert out.direction_result.direction_label != dr.direction_label
    assert out.direction_result.confidence < dr.confidence


def test_phase2_bear_positive_curve_scale_mode():
    """Fase 2 bear con curva positiva: scale flip in mode scale."""
    dr = direction_ensemble_detail(
        2,
        exc_slope=-0.2,
        slope=-0.1,
        rsi_val=75,
        vol_ratio=1.0,
        vol_accel=1.0,
        run_up=22,
        slope_5d=-0.5,
        slope_20d=-0.4,
        run_up_7d=18,
        ath_prox=0.95,
    )
    if not dr.direction_label.startswith("↓"):
        pytest.skip("fixture non bear in Ph2")
    pcts = {"model_dm60_pct": 6.0, "model_dm30_pct": 5.0}
    out = reconcile_direction_and_curve(
        dr,
        pcts,
        config=CurveAlignConfig(mode="scale"),
    )
    assert out.model_pcts["model_dm60_pct"] <= 0
    assert out.curve_direction_implied in ("down", "flat")


def test_stable_direction_damps_large_curve():
    dr = DirectionResult(
        direction_label="→ Stabile",
        confidence=0.6,
        bull_score=2,
        bear_score=2,
        net_score=0,
        phase=3,
    )
    pcts = {"model_dm60_pct": 15.0, "model_dm30_pct": 12.0}
    out = reconcile_direction_and_curve(dr, pcts, config=CurveAlignConfig(mode="scale"))
    assert out.model_pcts["model_dm60_pct"] == pytest.approx(5.25, abs=0.05)
    assert out.reconcile_action == "scale"


def test_curve_direction_implied_flat_within_epsilon():
    pol, sig = curve_direction_implied({"model_dm60_pct": 0.3}, epsilon=0.5)
    assert pol == "flat"
    assert sig == pytest.approx(0.3)


def test_env_epsilon_from_environment(monkeypatch):
    from prediction import config as cfg

    cfg.reset_config()
    monkeypatch.setenv("PRED_CURVE_ALIGN_EPSILON", "1.0")
    assert cfg.pred_curve_align_epsilon() == 1.0
    cfg.reset_config()
