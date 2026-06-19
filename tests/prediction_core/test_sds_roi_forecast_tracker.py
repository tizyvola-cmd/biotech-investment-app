"""Tests for SDS ROI forecast tracker."""
from __future__ import annotations

import json

from prediction.sds_roi_forecast_tracker import (
    append_sds_roi_forecasts,
    build_sds_roi_backtest_scores,
)


def test_backtest_scores_empty():
    doc = build_sds_roi_backtest_scores(correlation_doc={"calibration_rows": []})
    assert doc["n_scored"] == 0
    assert "summary_by_horizon" in doc
    assert "summary_by_sds_zone" in doc
    assert set(doc["summary_by_sds_zone"]) == {"distant", "watch", "candidate", "supernova"}


def test_backtest_scores_zone_summary():
    doc = build_sds_roi_backtest_scores(
        correlation_doc={
            "calibration_rows": [
                {
                    "key": "A|2024-01-01",
                    "ticker": "A",
                    "sds": 40.0,
                    "roi": {"off_-5": 5.0},
                }
            ],
            "pooled_extended": {"correlation": {}},
        }
    )
    # Without full ROI/prediction pipeline rows may not score; structure still present
    watch = doc["summary_by_sds_zone"]["watch"]["pre_5"]
    assert "n" in watch
    assert "mean_signed_err_pp" in watch


def test_append_forecast_log(tmp_path, monkeypatch):
    import prediction.sds_roi_forecast_tracker as mod

    log_path = tmp_path / "forecast_log.json"
    monkeypatch.setattr(mod, "SDS_ROI_FORECAST_LOG_JSON", str(log_path))

    snap = {
        "rows": [
            {
                "ticker": "TEST",
                "completion_date": "2027-01-01",
                "sds": 55.0,
                "curve_roi": {
                    "horizons": {"pre_5": {"pct_vs_m60": 12.0}, "pre_10": {"pct_vs_m60": 8.0}},
                    "horizons_curve": {"pre_5": {"pct_vs_m60": 11.0}},
                    "horizons_pred": {"pre_5": {"pct_vs_m60": 9.0}},
                },
            }
        ]
    }
    log = append_sds_roi_forecasts(snap, past_map={})
    ev = log["events"]["TEST|2027-01-01"]
    assert ev["snapshots"]
    snap0 = ev["snapshots"][0]
    assert snap0["predicted_blend"]["pre_5"] == 11.0
    assert snap0["predicted_pred"]["pre_5"] == 9.0
    assert "blend_vs_pred" in log["forward_summary"]
    assert log_path.is_file()


def test_blend_eval_summary_mae(tmp_path, monkeypatch):
    import prediction.sds_roi_forecast_tracker as mod
    from datetime import date, timedelta

    log_path = tmp_path / "forecast_log.json"
    monkeypatch.setattr(mod, "SDS_ROI_FORECAST_LOG_JSON", str(log_path))
    mature_cd = (date.today() - timedelta(days=30)).isoformat()
    past_key = f"MATURE|{mature_cd}"
    log_path.write_text(
        json.dumps(
            {
                "version": 1,
                "events": {
                    past_key: {
                        "key": past_key,
                        "ticker": "MATURE",
                        "completion_date": mature_cd,
                        "snapshots": [
                            {
                                "captured_at": "2026-05-01",
                                "predicted_blend": {"pre_5": 10.0},
                                "predicted_pred": {"pre_5": 14.0},
                            }
                        ],
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    past_map = {
        past_key: {
            "ticker": "MATURE",
            "completion_date": mature_cd,
            "curve_act_pct": {"-5": 8.0},
        }
    }
    log = append_sds_roi_forecasts({"rows": []}, past_map=past_map)
    ev = log["events"][past_key]
    assert ev["error_pp_blend"]["pre_5"] == 2.0
    assert ev["error_pp_pred"]["pre_5"] == 6.0
    summary = log["forward_summary"]["blend_vs_pred"]["by_horizon"]["pre_5"]
    assert summary["blend_better_n"] == 1
    assert summary["mae_blend_pp"] == 2.0
    assert summary["mae_pred_pp"] == 6.0
