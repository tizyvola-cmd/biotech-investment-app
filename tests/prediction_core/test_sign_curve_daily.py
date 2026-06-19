"""Tests for daily sign curve aggregation (schema v3)."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prediction.sign_curve_daily import (  # noqa: E402
    DAILY_FLAT_BAND_PP,
    POST_CD_CALENDAR_DAYS,
    SIGN_CURVE_X_OFFSETS,
    _aggregate_sessions,
    _bin_for_cal_offset,
    _bin_range,
    _price_level_accuracy_pct,
    _sign_hit_daily,
    _x_label,
)


def test_sign_hit_daily_up_down():
    assert _sign_hit_daily(1.0, 0.5) is True
    assert _sign_hit_daily(-1.0, -0.5) is True
    assert _sign_hit_daily(1.0, -0.5) is False


def test_price_level_accuracy_pct():
    assert _price_level_accuracy_pct(100.0, 100.0) == 100.0
    assert _price_level_accuracy_pct(110.0, 100.0) == 90.0
    assert _price_level_accuracy_pct(200.0, 100.0) == 0.0
    assert _price_level_accuracy_pct(50.0, 100.0) == 50.0


def test_x_labels_and_bins():
    assert _x_label(-60) == "-60"
    assert _bin_range(-60) == (-60, -51)
    assert _bin_range(-7) == (-7, -7)
    assert _bin_for_cal_offset(-55) == -60
    assert _bin_for_cal_offset(-7) == -7
    assert len(SIGN_CURVE_X_OFFSETS) >= 10


def test_aggregate_sessions_by_offset():
    sessions = [
        {"cal_offset": -58, "sign_hit": True, "price_accuracy_pct": 92.0},
        {"cal_offset": -57, "sign_hit": False, "price_accuracy_pct": 88.0},
        {"cal_offset": -10, "sign_hit": True, "price_accuracy_pct": 95.0},
        {"cal_offset": 3, "sign_hit": True, "price_accuracy_pct": 91.0},
    ]
    agg = _aggregate_sessions(sessions)
    assert agg["n_sessions"] == 4
    by = {b["offset"]: b for b in agg["by_offset"]}
    assert by[-60]["sign_hit_pct"] == 50.0
    assert by[-10]["sign_hit_pct"] == 100.0
    assert by[3]["price_accuracy_pct"] == 91.0
    assert agg["overall_price_accuracy_pct"] == 91.5


def test_flat_band_constant():
    assert DAILY_FLAT_BAND_PP == 0.5
    assert POST_CD_CALENDAR_DAYS == 7
