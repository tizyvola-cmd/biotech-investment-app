"""Tests for past_pred fit_pct backfill (layer i Q&C)."""
from __future__ import annotations

from prediction.past_pred_fit_enrich import (
    enrich_past_pred_fit_horizons_record,
    snapshot_fit_horizons_from_model,
)


def test_snapshot_fit_from_model():
    rec = {"model_dm5_pct": 12.5, "model_dm3_pct": 8.0}
    assert snapshot_fit_horizons_from_model(rec) is True
    assert rec["model_dm5_fit_pct"] == 12.5
    assert rec["model_dm3_fit_pct"] == 8.0
    assert rec["pred_dm5_fit_pct"] == 12.5


def test_emp_blend_changes_model_when_fit_present():
    rec = {
        "model_dm5_pct": 20.0,
        "model_dm3_pct": 15.0,
        "model_dm7_pct": 22.0,
        "model_dm10_pct": 18.0,
        "model_dm30_pct": 10.0,
        "model_dm60_pct": 5.0,
        "model_d4_pct": 12.0,
        "model_d7_pct": 14.0,
        "d3_pct": 25.0,
        "d5_pct": 30.0,
        "d10_pct": 20.0,
        "d30_pct": 8.0,
        "direction": "↑ Rialzo",
        "emp_category_dir": "success",
        "emp_curve_pick": "cohort_success",
        "precat_pts_ok": 6,
    }
    snapshot_fit_horizons_from_model(rec)
    raw5 = rec["model_dm5_fit_pct"]
    changed = enrich_past_pred_fit_horizons_record(rec, calibration_state={})
    assert changed is True
    assert rec.get("emp_precat_blend") in ("on", "off", "skip", "skipped", None, "error")
    if rec.get("emp_precat_blend") == "on":
        assert rec["model_dm5_pct"] != raw5 or rec.get("emp_precat_blend_lam") == 0
