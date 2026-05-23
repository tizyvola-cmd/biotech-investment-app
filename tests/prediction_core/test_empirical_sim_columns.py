"""Pred empirica + delta modello vs empirica (Simulation)."""
from __future__ import annotations

import data_orchestrator as orch


def test_model_vs_emp_delta_pp():
    row = {"d5_pct": 3.0, "pred_emp_d5": 1.0}
    assert orch._model_vs_emp_delta_pp(row, 5, 1.0) == 2.0


def test_ensure_calibration_builds_curves():
    st = orch._ensure_calibration_state_for_empirical({})
    if not orch._state_has_curve_data(st):
        return  # past_pred assente in CI
    pe = orch._predict_empirical_curve_cat(st, "v4_options", "success", 5)
    assert pe.get("pred_pct") is not None
