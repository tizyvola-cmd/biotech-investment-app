"""Fase 2 v5: calibrazione fan, display Simulation, fan offsets."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from prediction.config import reset_config
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    apply_v5_sim_display_to_pred_points,
    predict_v5_fan_offsets,
    v5_q50_from_fan,
)
from prediction.v5.calibration import (
    apply_v5_calibration_to_distribution,
    fit_v5_calibration_from_past_rows,
)
from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution


@pytest.fixture(autouse=True)
def _reset_cfg():
    reset_config()
    yield
    reset_config()


def test_apply_v5_calibration_scales_fan_width():
    dist = PredictionDistribution(
        nodes={
            4: CurveNodeQuantiles(offset=4, q05=0.0, q50=10.0, q95=20.0),
        }
    )
    apply_v5_calibration_to_distribution(dist, {"sigma_scale": 2.0})
    node = dist.nodes[4]
    assert node.q50 == 10.0
    assert node.q05 == pytest.approx(-10.0)
    assert node.q95 == pytest.approx(30.0)


def test_v5_q50_from_fan():
    fan = {"4": {"q05": -1.0, "q50": 5.0, "q95": 11.0}}
    q = v5_q50_from_fan(fan)
    assert q["4"] == 5.0


def test_apply_v5_sim_display_blend():
    v4 = [0.0, 10.0, 20.0, None, None, None, None, None]
    row = {"v5_q50_offsets": {str(o): float(o) for o in SIMULATION_V5_Q50_OFFSETS}}
    with patch("prediction.pipeline.pred_v5_sim_display_mode", return_value="blend"):
        out = apply_v5_sim_display_to_pred_points(v4, row)
    assert out[1] == pytest.approx((10.0 + (-30.0)) / 2.0)


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_fan_offsets_populates_row(mock_curve):
    from prediction.v5.schema import PredictionDistribution

    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-2.0, q50=float(off), q95=2.0)
        for off in SIMULATION_V5_Q50_OFFSETS
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")

    row: dict = {"model_dm60_pct": 0.0, "model_d5_pct": 1.0}
    with patch("prediction.pipeline.pred_v5_calib_enabled", return_value=False):
        with patch("prediction.pipeline.pred_v5_anchor_q50_v4_enabled", return_value=False):
            with patch("prediction.pipeline.pred_v5_align_sign_v4_enabled", return_value=False):
                with patch("prediction.pipeline.pred_v5_cohort_prior_enabled", return_value=False):
                    fan = predict_v5_fan_offsets(row, apply_calibration=False)
    assert "v5_fan_offsets" in row
    assert fan["4"]["q50"] == 4.0
    assert row["v5_q50_offsets"]["4"] == 4.0


def test_fit_v5_calibration_returns_scale():
    state = fit_v5_calibration_from_past_rows({})
    assert "sigma_scale" in state
    assert 0.5 <= state["sigma_scale"] <= 3.0
