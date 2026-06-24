"""Accuracy CD passate: Pred modello ≠ Storico (close reali)."""
from __future__ import annotations

from datetime import date, timedelta

import data_orchestrator as orch
from prediction.live_recalib_sheet import (
    past_accuracy_k8_recalib_pct_points,
    past_accuracy_model_pred_pct_points,
    sheet_pred_pct_points,
)


def test_sheet_pred_past_accuracy_uses_model_not_live(monkeypatch):
    monkeypatch.delenv("ACCURACY_PAST_PRED_USE_LIVE", raising=False)
    past_cd = date.today() - timedelta(days=400)
    row = {
        "ticker": "ZZZZ",
        "completion_date": past_cd.isoformat(),
        "price_at_cd": 10.0,
        "model_dm60_pct": 0.0,
        "model_dm30_pct": 5.0,
        "model_dm10_pct": 10.0,
        "model_dm7_pct": 12.0,
        "model_dm5_pct": 15.0,
        "model_dm3_pct": 18.0,
        "model_d4_pct": 25.0,
        "model_d7_pct": 30.0,
        "seq_curve_pct_vs_m60": [0.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0, 50.0],
    }
    model_pts = past_accuracy_model_pred_pct_points(row, row)
    sheet_pts = sheet_pred_pct_points(
        row,
        row,
        completion_date=past_cd,
        is_past=True,
        accuracy=True,
        today=date.today(),
    )
    assert sheet_pts[1] == model_pts[1]
    assert float(sheet_pts[1]) < 20.0


def test_past_model_differs_from_seq_live_path():
    past_cd = date.today() - timedelta(days=400)
    row = {
        "ticker": "FAKE",
        "price_at_cd": 10.0,
        "model_dm60_pct": 0.0,
        "model_dm30_pct": 2.0,
        "model_dm10_pct": 4.0,
        "model_dm7_pct": 5.0,
        "model_dm5_pct": 6.0,
        "model_dm3_pct": 7.0,
        "model_d4_pct": 20.0,
        "model_d7_pct": 25.0,
        "seq_curve_pct_vs_m60": [0.0, 80.0, 80.0, 80.0, 80.0, 80.0, 80.0, 80.0],
    }
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(row)
    model_pts = past_accuracy_model_pred_pct_points(row, row)
    assert model_pts[1] is not None
    assert float(model_pts[1]) < 15.0
