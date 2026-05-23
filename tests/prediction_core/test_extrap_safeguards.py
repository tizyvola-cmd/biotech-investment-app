"""Extrapolation safeguards: dm60 dampening and post-pipeline cap."""
from __future__ import annotations

import pytest

from prediction.extrap_safeguards import (
    cap_pred_pct,
    damp_model_dm60_extrap,
    pred_dir_align_flip_factor,
    pred_stn_runup_threshold,
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


def test_pred_stn_runup_threshold_default_and_override(monkeypatch):
    """Default 15; override via PRED_STN_RUNUP_THRESHOLD."""
    monkeypatch.delenv("PRED_STN_RUNUP_THRESHOLD", raising=False)
    assert pred_stn_runup_threshold() == 15.0

    monkeypatch.setenv("PRED_STN_RUNUP_THRESHOLD", "20")
    assert pred_stn_runup_threshold() == 20.0

    monkeypatch.setenv("PRED_STN_RUNUP_THRESHOLD", "5")
    assert pred_stn_runup_threshold() == 5.0


def test_pred_dir_align_flip_factor_default_and_override(monkeypatch):
    """Default 0.5; clamped to [0.1, 1.0]; override via PRED_DIR_ALIGN_FLIP_FACTOR."""
    monkeypatch.delenv("PRED_DIR_ALIGN_FLIP_FACTOR", raising=False)
    assert pred_dir_align_flip_factor() == 0.5

    monkeypatch.setenv("PRED_DIR_ALIGN_FLIP_FACTOR", "0.3")
    assert pred_dir_align_flip_factor() == 0.3

    monkeypatch.setenv("PRED_DIR_ALIGN_FLIP_FACTOR", "0.0")  # below min → clamped to 0.1
    assert pred_dir_align_flip_factor() == 0.1

    monkeypatch.setenv("PRED_DIR_ALIGN_FLIP_FACTOR", "1.5")  # above max → clamped to 1.0
    assert pred_dir_align_flip_factor() == 1.0


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
