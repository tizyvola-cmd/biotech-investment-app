"""Pre-CD vs post-CD v4 horizon adjustments (Passo 2/3)."""
from __future__ import annotations

import pytest

from prediction.config import get_config
from prediction.curve_display import scale_display_pct_points_cal_factor
from prediction.fundamental_shrink import apply_v4_final_horizon_adjustments
from prediction.extrap_safeguards import pred_damp_dm60_extrap_enabled


def test_shrink_post_only_by_default(monkeypatch) -> None:
    monkeypatch.setenv("PRED_FUNDAMENTAL_SHRINK", "1")
    monkeypatch.setenv("PRED_FUNDAMENTAL_SHRINK_PRECD", "0")
    get_config(reload=True)
    hz = {"model_dm60_pct": 20.0, "d5_pct": 20.0}
    apply_v4_final_horizon_adjustments(
        hz, liquidity_score=0.0, beta=2.0,
    )
    assert hz["model_dm60_pct"] == pytest.approx(21.0)  # ×1.05 pre-CD, no shrink
    assert hz["d5_pct"] < 20.0


def test_precd_scale_default_105(monkeypatch) -> None:
    monkeypatch.setenv("PRED_FUNDAMENTAL_SHRINK", "0")
    monkeypatch.setenv("PRED_V4_CURVE_SCALE_PRECD", "1.05")
    monkeypatch.setenv("PRED_V4_CURVE_SCALE", "1.0")
    get_config(reload=True)
    hz = {"model_dm10_pct": 10.0, "d3_pct": 10.0}
    apply_v4_final_horizon_adjustments(hz, liquidity_score=1.0, beta=1.0)
    assert hz["model_dm10_pct"] == pytest.approx(10.5)
    assert hz["d3_pct"] == 10.0


def test_cal_factor_scales_display_not_anchor(monkeypatch) -> None:
    monkeypatch.setenv("PRED_CURVE_APPLY_CAL_FACTOR", "1")
    get_config(reload=True)
    offs = (-60, -30, 0)
    pts = [0.0, 5.0, 10.0]
    out = scale_display_pct_points_cal_factor(pts, offs, 1.1)
    assert out[0] == 0.0
    assert out[1] == pytest.approx(5.5)
    assert out[2] == pytest.approx(11.0)


def test_damp_dm60_default_off(monkeypatch) -> None:
    monkeypatch.delenv("PRED_DAMP_DM60_EXTRAP", raising=False)
    assert pred_damp_dm60_extrap_enabled() is False
    monkeypatch.setenv("PRED_DAMP_DM60_EXTRAP", "1")
    assert pred_damp_dm60_extrap_enabled() is True
