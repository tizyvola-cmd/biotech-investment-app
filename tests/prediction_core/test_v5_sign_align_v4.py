"""v5 q50 sign alignment with v4 reference."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from prediction.config import reset_config
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    align_v5_q50_signs_to_v4,
    predict_v5_q50_offsets,
    v4_implied_sign_at_offset,
)


def test_v4_implied_sign_from_pct():
    row = {"model_dm7_pct": -3.0, "direction": "↑ Forte"}
    assert v4_implied_sign_at_offset(row, -7) == -1


def test_v4_implied_sign_falls_back_to_direction():
    row = {"direction": "↓ Moderato"}
    assert v4_implied_sign_at_offset(row, 4) == -1


def test_align_flips_q50_preserving_magnitude():
    row = {"model_dm7_pct": 5.0}
    out = {"-7": -2.0, "4": 0.2}
    assert align_v5_q50_signs_to_v4(out, row) is True
    assert out["-7"] == 2.0
    assert out["4"] == 0.2  # below 0.5 pp threshold


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_align_disabled(mock_curve):
    from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution

    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-1.0, q50=-2.0, q95=1.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")
    row = {"model_dm7_pct": 8.0, "direction": "↑ Forte"}
    os.environ["PRED_V5_ALIGN_SIGN_V4"] = "0"
    os.environ["PRED_V5_ANCHOR_Q50_V4"] = "0"
    os.environ["PRED_V5_COHORT_PRIOR"] = "0"
    reset_config()
    try:
        out = predict_v5_q50_offsets(row)
        assert out["-7"] == -2.0
        assert row.get("v5_sign_aligned") is False
    finally:
        for k in ("PRED_V5_ALIGN_SIGN_V4", "PRED_V5_ANCHOR_Q50_V4", "PRED_V5_COHORT_PRIOR"):
            os.environ.pop(k, None)
        reset_config()


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_align_enabled(mock_curve):
    from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution

    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-5.0, q50=-3.0, q95=-1.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")
    row = {"model_dm7_pct": 6.0}
    os.environ["PRED_V5_ALIGN_SIGN_V4"] = "1"
    os.environ["PRED_V5_ANCHOR_Q50_V4"] = "0"
    os.environ["PRED_V5_COHORT_PRIOR"] = "0"
    reset_config()
    try:
        out = predict_v5_q50_offsets(row)
        assert out["-7"] == 3.0
        assert row.get("v5_sign_aligned") is True
        assert set(out.keys()) == {str(o) for o in SIMULATION_V5_Q50_OFFSETS}
    finally:
        for k in ("PRED_V5_ALIGN_SIGN_V4", "PRED_V5_ANCHOR_Q50_V4", "PRED_V5_COHORT_PRIOR"):
            os.environ.pop(k, None)
        reset_config()
