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
    reliability_index_for_days_to_cd,
    reliability_rating_for_days_to_cd,
    reliability_stars,
    reliability_window,
)


def _sim_snap(pairs):
    return {
        "cohorts": {
            "simulation": {
                "by_offset": [
                    {"offset": o, "sign_hit_pct": v, "n": 12} for (o, v) in pairs
                ]
            }
        }
    }


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


def _snapshot_with_offsets() -> dict:
    return {
        "cohorts": {
            "simulation": {
                "by_offset": [
                    {"offset": -60, "sign_hit_pct": 44.0, "n": 10},
                    {"offset": -5, "sign_hit_pct": 78.0, "n": 12},
                ]
            }
        }
    }


def test_reliability_index_for_days_to_cd_maps_distance_to_bin():
    snap = _snapshot_with_offsets()
    # T-5 -> exact bin -5
    assert reliability_index_for_days_to_cd(5, snapshot=snap) == 78.0
    # T-60 -> decade bin -60 covers -60..-51
    assert reliability_index_for_days_to_cd(55, snapshot=snap) == 44.0


def test_reliability_index_none_cases():
    snap = _snapshot_with_offsets()
    assert reliability_index_for_days_to_cd(None, snapshot=snap) is None
    assert reliability_index_for_days_to_cd(-3, snapshot=snap) is None  # post-CD
    assert reliability_index_for_days_to_cd(20, snapshot=snap) is None  # no bin in snapshot


def test_reliability_window_relative_to_peak():
    snap = _sim_snap([(-60, 55.0), (-30, 70.0), (-10, 80.0), (-5, 84.0), (-3, 76.0)])
    win = reliability_window(snapshot=snap)
    assert win["peak_pct"] == 84.0
    assert win["peak_offset"] == -5
    assert win["threshold_pct"] == 74.0  # peak - 10pp
    # nodes within 10pp of the peak: -10 (80), -5 (84), -3 (76)
    assert win["lo_offset"] == -10
    assert win["hi_offset"] == -3
    assert set(win["offsets"]) == {-10, -5, -3}


def test_reliability_window_none_without_curve():
    assert reliability_window(snapshot={}) is None
    assert reliability_window(snapshot=_sim_snap([])) is None


def test_reliability_stars_bands_relative_to_peak():
    assert reliability_stars(84.0, 84.0) == 5  # at the peak
    assert reliability_stars(83.0, 84.0) == 5  # gap 1pp -> [0,2) -> 5
    assert reliability_stars(82.0, 84.0) == 4  # gap 2pp -> [2,4) -> 4
    assert reliability_stars(78.0, 84.0) == 2  # gap 6pp -> [6,8) -> 2
    assert reliability_stars(74.0, 84.0) == 1  # gap 10pp -> clamped to 1
    assert reliability_stars(None, 84.0) is None


def test_reliability_rating_gates_outside_window():
    snap = _sim_snap([(-60, 55.0), (-30, 70.0), (-10, 80.0), (-5, 84.0), (-3, 76.0)])
    # T-60 -> R 55 < threshold 74 -> not reliable, no stars (no estimate)
    out = reliability_rating_for_days_to_cd(60, snapshot=snap)
    assert out["reliable"] is False
    assert out["stars"] is None
    # T-5 -> R 84 (the peak) -> reliable, 5 stars
    inside = reliability_rating_for_days_to_cd(5, snapshot=snap)
    assert inside["reliable"] is True
    assert inside["stars"] == 5


def test_reliability_rating_no_curve_applies_no_gate():
    out = reliability_rating_for_days_to_cd(30, snapshot={})
    assert out["reliable"] is None
    assert out["stars"] is None
