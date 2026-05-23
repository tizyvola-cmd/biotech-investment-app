"""PRED_V4_CURVE_SCALE multiplier on v4 horizon pcts."""
from __future__ import annotations

import os

import pytest

from prediction.config import reset_config
from prediction.fundamental_shrink import apply_v4_final_horizon_adjustments


def test_curve_scale_only_when_not_one():
    os.environ["PRED_FUNDAMENTAL_SHRINK"] = "0"
    os.environ["PRED_V4_CURVE_SCALE"] = "1.05"
    reset_config()
    try:
        hz = {"d5_pct": 10.0, "model_dm30_pct": -8.0}
        meta = apply_v4_final_horizon_adjustments(
            hz, liquidity_score=0.0, beta=2.0
        )
        assert hz["d5_pct"] == pytest.approx(10.5, abs=0.05)
        assert hz["model_dm30_pct"] == pytest.approx(-8.4, abs=0.05)
        assert meta.get("v4_curve_scale") == 1.05
    finally:
        os.environ.pop("PRED_FUNDAMENTAL_SHRINK", None)
        os.environ.pop("PRED_V4_CURVE_SCALE", None)
        reset_config()


def test_shrink_then_scale():
    os.environ["PRED_FUNDAMENTAL_SHRINK"] = "1"
    os.environ["PRED_V4_CURVE_SCALE"] = "1.1"
    reset_config()
    try:
        hz = {"d3_pct": 20.0}
        meta = apply_v4_final_horizon_adjustments(
            hz, liquidity_score=0.0, beta=2.0
        )
        m = meta["fundamental_shrink_m"]
        assert hz["d3_pct"] == pytest.approx(round(20.0 * m * 1.1, 1))
    finally:
        os.environ.pop("PRED_FUNDAMENTAL_SHRINK", None)
        os.environ.pop("PRED_V4_CURVE_SCALE", None)
        reset_config()
