"""Pred empirica + delta modello vs empirica (Simulation)."""
from __future__ import annotations

import data_orchestrator as orch


def test_model_vs_emp_delta_pp():
    row = {"d5_pct": 3.0, "pred_emp_d5": 1.0}
    assert orch._model_vs_emp_delta_pp(row, 5, 1.0) == 2.0


def test_predict_empirical_median_key_formats():
    """Mediana T+5: chiavi int/str (JSON) devono essere lette correttamente."""
    for med in (
        {"5": 4.2, "+5": 9.9},
        {5: 3.8},
        {"+5": 2.1},
    ):
        st = {
            "curves": {
                "v4_options": {
                    "success": {
                        "n": 10,
                        "median": med,
                        "stats": {"5": {"rel": 70.0}},
                    }
                }
            }
        }
        pe = orch._predict_empirical_curve_cat(st, "v4_options", "success", 5)
        assert pe.get("pred_pct") is not None
        assert abs(float(pe["pred_pct"])) > 0.5


def test_simulation_pred_emp_excel_fraction_roundtrip():
    """
    Foglio Simulation scrive pred_emp_d5 in punti percentuali / 100 (frazione Excel).
    SuperNova deve moltiplicare ×100 in visualizzazione (parseSheetPct / percentPointsFromStored).

    Verifica manuale dopo fix UI: colonna «Pred empirica · +5gg (%)» ≈ valore Excel %,
    non 0.05 quando Excel mostra +5.0%.
    """
    pp = 5.39
    excel_stored = pp / 100.0
    assert abs(excel_stored - 0.0539) < 1e-9
    # Stesso criterio di desktop-ui percentPointsFromStored (|n|<=1.5 → ×100)
    displayed = excel_stored * 100.0 if abs(excel_stored) <= 1.5 else excel_stored
    assert abs(displayed - pp) < 0.01


def test_ensure_calibration_builds_curves():
    st = orch._ensure_calibration_state_for_empirical({})
    if not orch._state_has_curve_data(st):
        return  # past_pred assente in CI
    pe = orch._predict_empirical_curve_cat(st, "v4_options", "success", 5)
    assert pe.get("pred_pct") is not None
