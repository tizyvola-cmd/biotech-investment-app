"""Expected Move Score: magnitude calibration + scoring (direction-agnostic)."""
from __future__ import annotations

from prediction.expected_move_score import (
    build_expected_move_calibration,
    expected_move_predictor,
    score_expected_move,
)


def test_predictor_is_mean_absolute_curve_magnitude():
    rec = {"model_dm5_pct": -4.0, "model_d3_pct": 2.0, "model_d5_pct": -6.0}
    assert expected_move_predictor(rec) == (4.0 + 2.0 + 6.0) / 3.0


def test_predictor_none_without_any_node():
    assert expected_move_predictor({"foo": 1.0}) is None


def _synthetic_samples():
    # predictor monotonically tracks |move| (with scatter) so buckets must rank up
    samples = []
    for i in range(500):
        p = i / 50.0  # 0..10
        mv = abs(p) + ((i % 7) - 3) * 0.3  # signal + noise
        samples.append((p, abs(mv)))
    return samples


def test_calibration_buckets_are_monotonic_and_active():
    cal = build_expected_move_calibration(_synthetic_samples(), dry_run=True)
    assert cal["status"] == "active"
    meds = [b["median_move_pp"] for b in cal["buckets"]]
    assert meds == sorted(meds)  # non-decreasing realized move across quintiles
    assert cal["buckets"][-1]["straddle_candidate"] is True
    assert cal["buckets"][0]["straddle_candidate"] is False


def test_insufficient_data_status():
    cal = build_expected_move_calibration([(1.0, 2.0)] * 10, dry_run=True)
    assert cal["status"] == "insufficient_data"


def test_score_low_vs_high_predictor():
    cal = build_expected_move_calibration(_synthetic_samples(), dry_run=True)
    low = score_expected_move(0.2, cal)
    high = score_expected_move(9.8, cal)
    assert low["bucket"] < high["bucket"]
    assert high["expected_move_score"] > low["expected_move_score"]
    assert high["straddle_candidate"] is True
    assert low["straddle_candidate"] is False
    # the score never claims a direction
    assert "magnitudine" in high["note"].lower()


def test_score_uncalibrated_without_calibration():
    out = score_expected_move(3.0, {})
    assert out["status"] == "uncalibrated"
    assert out["expected_move_score"] is None


def test_score_accepts_record_dict():
    cal = build_expected_move_calibration(_synthetic_samples(), dry_run=True)
    out = score_expected_move({"model_dm5_pct": 9.0, "model_d3_pct": 9.0, "model_d5_pct": 9.0}, cal)
    assert out["status"] == "active"
    assert out["predictor"] == 9.0
