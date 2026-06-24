"""Tests for pre-CD curve impact (path RMSE)."""
from __future__ import annotations

from prediction.past_pred_display_enrich import enrich_past_pred_display_record
from prediction.pre_cd_curve_impact import (
    RECALIB_SCHEDULE,
    _build_eis_cohort_comparison,
    _extract_event,
    _resolve_pred_levels,
    _scheduled_recalib_path,
)


def test_resolve_pred_levels_forward_pipeline():
    rec = {
        "model_dm5_pct": 10.0,
        "pred_dm5_fit_pct": 10.0,
        "eis_poly_shift_pp": 2.0,
        "cal_factor": 1.1,
        "model_dm5_display_pct": 13.2,
    }
    levels = _resolve_pred_levels(rec, cf_default=1.0)
    assert levels is not None
    assert levels["pred_base_pp"] == 10.0
    assert levels["pred_post_eis_pp"] == 12.0
    assert levels["pred_final_pp"] == 13.2


def test_scheduled_recalib_snaps_to_actual_at_calendar_nodes():
    offsets = (-60, -30, -10, -7, -5, -3)
    raw = [0.0, 5.0, 8.0, 10.0, 12.0, 14.0]
    actual = [0.0, 20.0, 15.0, 18.0, 22.0, 25.0]
    out = _scheduled_recalib_path(raw, actual, offsets, schedule=RECALIB_SCHEDULE)
    assert out[0] == 0.0
    assert out[1] == 20.0  # -30 snap
    assert out[4] == 22.0  # -5 snap


def test_extract_event_path_rmse():
    rec = {
        "ticker": "TEST",
        "completion_date": "2024-06-01",
        "close_m60": 100.0,
        "close_m30": 110.0,
        "close_m10": 115.0,
        "close_m7": 118.0,
        "close_m5": 120.0,
        "close_m3": 122.0,
        "model_dm60_pct": 0.0,
        "model_dm30_pct": 5.0,
        "model_dm10_pct": 8.0,
        "model_dm7_pct": 10.0,
        "model_dm5_pct": 10.0,
        "model_dm3_pct": 12.0,
        "pred_dm5_fit_pct": 10.0,
        "eis_poly_shift_pp": 1.0,
        "cal_factor": 1.0,
        "model_dm5_display_pct": 11.0,
    }
    ev = _extract_event(
        rec,
        cf_default=1.0,
        chart_series={},
        enrich_index={},
    )
    assert ev is not None
    assert ev["path_rmse_base"] is not None
    assert ev["path_rmse_daily"] is not None
    assert ev["path_rmse_k8"] is not None
    assert ev["path_rmse_eis"] is not None


def test_eis_detected_uses_eis_score_nonzero():
    from prediction.pre_cd_curve_impact import _eis_detected

    assert _eis_detected({"eis_score": 12.5, "eis_shift_pp": 0.0}) is True
    assert _eis_detected({"eis_score": -3.2, "eis_shift_pp": 0.0}) is True
    assert _eis_detected({"eis_score": 0.0, "eis_shift_pp": 0.0}) is False
    assert _eis_detected({"eis_score": None, "eis_shift_pp": 0.0}) is False
    assert _eis_detected({"eis_score": None, "eis_shift_pp": 1.5}) is True


def test_eis_cohort_comparison_splits_detected_vs_absent():
    base_rec = {
        "ticker": "TEST",
        "completion_date": "2024-06-01",
        "close_m60": 100.0,
        "close_m30": 110.0,
        "close_m10": 115.0,
        "close_m7": 118.0,
        "close_m5": 120.0,
        "close_m3": 122.0,
        "model_dm60_pct": 0.0,
        "model_dm30_pct": 5.0,
        "model_dm10_pct": 8.0,
        "model_dm7_pct": 10.0,
        "model_dm5_pct": 10.0,
        "model_dm3_pct": 12.0,
        "pred_dm5_fit_pct": 10.0,
        "cal_factor": 1.0,
        "model_dm5_display_pct": 11.0,
    }
    with_eis_rec = {**base_rec, "eis_poly_shift_pp": 2.0, "eis_poly_applied": True}
    without_eis_rec = {**base_rec, "ticker": "NONE", "eis_poly_shift_pp": 0.0}

    ev_with = _extract_event(with_eis_rec, cf_default=1.0, chart_series={}, enrich_index={})
    ev_without = _extract_event(without_eis_rec, cf_default=1.0, chart_series={}, enrich_index={})
    assert ev_with is not None and ev_without is not None

    out = _build_eis_cohort_comparison([ev_with, ev_without])
    assert out["with_eis"]["n"] == 1
    assert out["without_eis"]["n"] == 1
    assert out["with_eis"]["price_accuracy_pct"] is not None
    assert out["without_eis"]["sign_hit_pct"] is not None


def test_enrich_record_sets_display_fields():
    rec = {
        "ticker": "ABCD",
        "completion_date": "2024-01-15",
        "model_dm5_pct": 5.0,
    }
    enrich_past_pred_display_record(rec, {"cal_factor": {"v4_options": 1.05}}, force=True)
    assert rec["pred_dm5_fit_pct"] == 5.0
    assert rec["cal_factor"] == 1.05
    assert "eis_poly_shift_pp" in rec
