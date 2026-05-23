"""v5 q50 anchored to v4 with MC band width preserved."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from prediction.config import reset_config
from prediction.pipeline import (
    anchor_v5_distribution_q50_to_v4,
    predict_v5_q50_offsets,
    v4_pct_at_v5_offsets,
)
from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution


def test_anchor_shifts_q50_to_v4_keeps_spread():
    dist = PredictionDistribution(
        nodes={
            -7: CurveNodeQuantiles(offset=-7, q05=-5.0, q50=-2.0, q95=1.0),
        },
        regime="trend",
    )
    assert anchor_v5_distribution_q50_to_v4(dist, {-7: 4.0}) is True
    n = dist.nodes[-7]
    assert n.q50 == pytest.approx(4.0, abs=0.01)
    assert n.q05 == pytest.approx(1.0, abs=0.01)
    assert n.q95 == pytest.approx(7.0, abs=0.01)


def test_v4_pct_at_offsets_reads_model_keys():
    row = {"model_dm7_pct": -3.5, "model_dm5_pct": -2.0}
    assert v4_pct_at_v5_offsets(row)[-7] == -3.5
    assert v4_pct_at_v5_offsets(row)[-5] == -2.0


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_anchor_enabled(mock_curve):
    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-8.0, q50=-4.0, q95=0.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")
    row = {"model_dm7_pct": 6.0, "model_dm5_pct": 5.0}
    os.environ["PRED_V5_ANCHOR_Q50_V4"] = "1"
    os.environ["PRED_V5_ALIGN_SIGN_V4"] = "0"
    os.environ["PRED_V5_COHORT_PRIOR"] = "0"
    reset_config()
    try:
        out = predict_v5_q50_offsets(row)
        assert out["-7"] == 6.0
        assert row.get("v5_q50_anchored_v4") is True
    finally:
        for k in ("PRED_V5_ANCHOR_Q50_V4", "PRED_V5_ALIGN_SIGN_V4", "PRED_V5_COHORT_PRIOR"):
            os.environ.pop(k, None)
        reset_config()
