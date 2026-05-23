"""Extrapolation safeguards: dm60 dampening and post-pipeline cap."""
from __future__ import annotations

import pytest

from prediction.extrap_safeguards import (
    cap_pred_pct,
    damp_model_dm60_extrap,
    sheet_use_seq_curve_for_pred,
)


def test_damp_dm60_low_r2_pulls_toward_dm30():
    out = damp_model_dm60_extrap(
        25.0,
        5.0,
        best_r2=0.25,
        run_up_30d=None,
        days_to_t=45,
    )
    assert out is not None
    assert out < 25.0
    assert out > 5.0


def test_damp_dm60_high_runup_shrinks_positive():
    out = damp_model_dm60_extrap(
        20.0,
        10.0,
        best_r2=0.6,
        run_up_30d=40.0,
        days_to_t=20,
    )
    assert out is not None
    assert out < 20.0


def test_cap_pred_pct_enforces_limit():
    assert cap_pred_pct(40.0) == 25.0
    assert cap_pred_pct(-30.0) == -25.0
    assert cap_pred_pct(10.0) == 10.0


def test_hura_like_high_runup_dm60_not_at_cap_without_reason(monkeypatch):
    """HURA-like: weak R² + large run-up → dm60 well below raw poly extrap (+25 cap)."""
    monkeypatch.setenv("PRED_EXTRAP_MAX_RUNUP", "15")
    raw_dm60 = 25.0
    dm30 = 8.0
    out = damp_model_dm60_extrap(
        raw_dm60,
        dm30,
        best_r2=0.35,
        run_up_30d=35.0,
        days_to_t=32,
    )
    assert out is not None
    assert out < raw_dm60
    assert out < 18.0


def test_sheet_seq_curve_default_on_model_only_opt_out(monkeypatch):
    monkeypatch.delenv("SIMULATION_SHEET_USE_SEQ_CURVE", raising=False)
    monkeypatch.delenv("ACCURACY_SHEET_USE_SEQ_CURVE", raising=False)
    monkeypatch.delenv("SIMULATION_SHEET_USE_MODEL_ONLY", raising=False)
    monkeypatch.delenv("ACCURACY_SHEET_USE_MODEL_ONLY", raising=False)
    assert sheet_use_seq_curve_for_pred(accuracy=False) is True
    assert sheet_use_seq_curve_for_pred(accuracy=True) is True
    monkeypatch.setenv("SIMULATION_SHEET_USE_MODEL_ONLY", "1")
    assert sheet_use_seq_curve_for_pred(accuracy=False) is False
    monkeypatch.delenv("SIMULATION_SHEET_USE_MODEL_ONLY", raising=False)
    monkeypatch.setenv("SIMULATION_SHEET_USE_SEQ_CURVE", "0")
    assert sheet_use_seq_curve_for_pred(accuracy=False) is False
