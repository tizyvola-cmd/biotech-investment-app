"""Regime multiplier robustness: apply-side guards + circuit breaker.

Mirrors the cluster cal_factor guards so a regime layer with thin/noisy
evidence stays neutral instead of adding MAE.
"""
from __future__ import annotations

import json

from prediction import regime_calibration as rc


def _patch_factors(monkeypatch, entry: dict) -> None:
    monkeypatch.setattr(rc, "load_regime_multipliers", lambda: {"RISK_ON": entry})


def test_apply_side_requires_min_samples(monkeypatch):
    _patch_factors(monkeypatch, {"multiplier": 0.8, "n": 5, "bias_pp": 3.0, "status": "active"})
    assert rc.robust_regime_multiplier("RISK_ON") == 1.0


def test_apply_side_deadbands_noise_bias(monkeypatch):
    _patch_factors(monkeypatch, {"multiplier": 0.92, "n": 40, "bias_pp": 0.4, "status": "active"})
    assert rc.robust_regime_multiplier("RISK_ON") == 1.0


def test_apply_side_insufficient_data_is_neutral(monkeypatch):
    _patch_factors(monkeypatch, {"multiplier": 0.8, "n": 40, "bias_pp": 3.0, "status": "insufficient_data"})
    assert rc.robust_regime_multiplier("RISK_ON") == 1.0


def test_apply_side_shrinks_toward_one(monkeypatch):
    # n=30 -> shrink_w = 30/50 = 0.6; 1.0 + (0.8-1.0)*0.6 = 0.88
    _patch_factors(monkeypatch, {"multiplier": 0.8, "n": 30, "bias_pp": 3.0, "status": "active"})
    assert rc.robust_regime_multiplier("RISK_ON") == 0.88


def test_apply_side_clamps(monkeypatch):
    _patch_factors(monkeypatch, {"multiplier": 0.2, "n": 10_000, "bias_pp": 9.0, "status": "active"})
    assert rc.robust_regime_multiplier("RISK_ON") == rc.REGIME_MULT_FLOOR


def test_regime_breaker_freezes_diverging_multiplier(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"regime_multipliers": {"RISK_ON": 0.95}, "mae_after_regime": 7.1, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 0.85}, "mae_after_regime": 7.6, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 0.75}, "mae_after_regime": 7.9, "mae_baseline": 7.2},
        ]
    }
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(rc, "LEARNING_HISTORY_JSON", str(lh))

    cb = rc._circuit_breaker_for_regime("RISK_ON", 0.71)
    assert cb.triggered is True
    assert cb.value == 0.95


def test_regime_breaker_passes_when_helping(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"regime_multipliers": {"RISK_ON": 1.05}, "mae_after_regime": 7.0, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 1.10}, "mae_after_regime": 6.9, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 1.15}, "mae_after_regime": 6.8, "mae_baseline": 7.2},
        ]
    }
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(rc, "LEARNING_HISTORY_JSON", str(lh))

    cb = rc._circuit_breaker_for_regime("RISK_ON", 1.2)
    assert cb.triggered is False
    assert cb.value == 1.2
