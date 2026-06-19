"""Tests for SDS ↔ ROI correlation calibration."""
from __future__ import annotations

from prediction.sds_roi_correlation import (
    _estimate_from_profile_anchors,
    _pearson,
    _sds_supernova_weight,
    build_sds_roi_correlation,
    estimate_roi_from_sds_correlation,
)


def test_pearson_positive():
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert _pearson(xs, ys) == 1.0


def test_sds_supernova_weight():
    assert _sds_supernova_weight(30) == 0.0
    assert _sds_supernova_weight(75) == 1.0
    assert abs(_sds_supernova_weight(52.5) - 0.5) < 0.01


def test_anchor_blend_between_neutro_and_cluster1():
    anchors = {
        "post_neutro": {"median_roi_pct_vs_m60": {"pre_10": 0.0, "pre_5": 0.0, "post_4": 0.0}},
        "cluster1": {"median_roi_pct_vs_m60": {"pre_10": 60.0, "pre_5": 6.0, "post_4": 50.0}},
    }
    hz = _estimate_from_profile_anchors(43.0, anchors)
    assert hz is not None
    w = _sds_supernova_weight(43.0)
    assert abs(hz["pre_10"]["pct_vs_m60"] - round(60.0 * w, 2)) < 0.01
    assert hz["pre_10"]["source"] == "anchor_blend"


def test_build_correlation_structure():
    doc = build_sds_roi_correlation(past_map={}, sample_n=5)
    assert "profiles" in doc
    assert "pooled_post_cd" in doc
    assert "pooled_extended" in doc
    assert "profile_anchors" in doc
    for prof in ("post_rialzo", "post_ribasso", "post_neutro", "cluster1", "cluster0"):
        assert prof in doc["profiles"]
        assert prof in doc["profile_anchors"]


def test_estimate_from_sds_live_range():
    build_sds_roi_correlation(past_map={}, sample_n=5)
    est = estimate_roi_from_sds_correlation(43.0, profile="post_neutro")
    assert est is None or "horizons" in est
