"""Tests for prediction.seq_calib knot helpers."""
from __future__ import annotations

import pandas as pd

from prediction.seq_calib import (
    DEFAULT_CAL_OFFSETS,
    pred_curve_seq_snap_cal_day_to_offset_index,
    pred_curve_series_upto_trade_date,
)


def test_snap_cal_day_to_offset_index():
    idx = pred_curve_seq_snap_cal_day_to_offset_index(-7, DEFAULT_CAL_OFFSETS)
    assert idx == 3  # offset -7 in default tuple


def test_series_upto_trade_date_truncates():
    idx = pd.date_range("2024-01-01", periods=5, freq="D")
    ser = pd.Series([1.0, 2, 3, 4, 5], index=idx)
    out = pred_curve_series_upto_trade_date(ser, idx[2].date())
    assert out is not None
    assert len(out) == 3
