"""Tests for SDS ROI calibration from past catalyst cohorts."""
from __future__ import annotations

from prediction.sds_roi_calibration import (
    ROI_STANDARD_OFFSETS,
    _aggregate_profile_roi,
    build_sds_roi_calibration,
    classify_past_profile,
)


def test_standard_offsets():
    assert ROI_STANDARD_OFFSETS == (-10, -5, 4)


def test_classify_post_rialzo():
    rec = {
        "ticker": "TEST",
        "completion_date": "2024-06-01",
        "curve_act_pct": {
            "-10": 5.0,
            "-7": 6.0,
            "-5": 7.0,
            "4": 20.0,
            "7": 22.0,
        },
    }
    assert classify_past_profile(rec) == "post_rialzo"


def test_aggregate_profile_roi_medians():
    members = [
        {"roi": {"off_-10": 10.0, "off_-5": 15.0, "off_4": 20.0}},
        {"roi": {"off_-10": 20.0, "off_-5": 25.0, "off_4": 30.0}},
    ]
    agg = _aggregate_profile_roi(members)
    assert agg["n"] == 2
    assert agg["median_pct_vs_m60"]["-10"] == 15.0
    assert agg["median_pct_vs_m60"]["-5"] == 20.0
    assert agg["median_pct_vs_m60"]["4"] == 25.0


def test_build_calibration_structure():
    doc = build_sds_roi_calibration(past_map={}, sample_n=10)
    assert doc["standard_offsets"] == [-10, -5, 4]
    assert "profiles" in doc
    for prof in ("cluster1", "cluster0", "post_rialzo", "post_ribasso", "post_neutro"):
        assert prof in doc["profiles"]
