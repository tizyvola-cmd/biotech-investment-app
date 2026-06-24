"""Smoke tests for node-based evaluation framework."""
from prediction.evaluationFramework import (
    actual_pct_at_node,
    compare_evaluations,
    evaluate_nodes,
    run_full_evaluation,
)


def test_actual_pct_at_decision_zero():
    rec = {"close_m10": 100.0, "close_m5": 105.0}
    assert actual_pct_at_node(rec, "close_m10") == 0.0
    assert actual_pct_at_node(rec, "close_m5") == 5.0


def test_evaluate_nodes_on_sample():
    rows = {
        "AAA|2025-01-01": {
            "ticker": "AAA",
            "completion_date": "2025-01-01",
            "close_m10": 10.0,
            "close_m5": 10.5,
            "close_m60": 9.0,
            "model_dm5_pct": 4.0,
            "model_dm10_pct": 0.0,
        }
    }
    out = evaluate_nodes(rows, today=__import__("datetime").date(2026, 1, 1))
    t5 = next(n for n in out["nodes"] if n["node"] == "T-5")
    assert t5["n_samples"] == 1
    assert t5["mae"] == 1.0


def test_run_full_evaluation_writes_cache(tmp_path, monkeypatch):
    import prediction.evaluationFramework as ef

    monkeypatch.setattr(ef, "EVAL_RESULTS_PATH", tmp_path / "eval.json")
    result = run_full_evaluation(lookback_cds=3, use_mock_if_sparse=True)
    assert "node_accuracy" in result
    assert (tmp_path / "eval.json").is_file()


def test_compare_evaluations_mae_delta():
    baseline = {
        "generated_at": "2026-01-01",
        "lookback_cds": 10,
        "node_accuracy": {
            "nodes": [
                {"node": "T-5", "mae": 12.0, "direction_accuracy": 0.35},
            ]
        },
        "layer_deltas": {"nodes": {"T-5": [{"layer": "seq_calib", "delta_mae_vs_base": -0.5}]}},
        "slope_signals": {"signals": [{"signal": "slope5", "direction_accuracy": 0.6}]},
    }
    current = {
        "generated_at": "2026-02-01",
        "lookback_cds": 10,
        "node_accuracy": {
            "nodes": [
                {"node": "T-5", "mae": 10.0, "direction_accuracy": 0.4},
            ]
        },
        "layer_deltas": {"nodes": {"T-5": [{"layer": "seq_calib", "delta_mae_vs_base": -1.0}]}},
        "slope_signals": {"signals": [{"signal": "slope5", "direction_accuracy": 0.67}]},
    }
    cmp = compare_evaluations(current, baseline)
    assert cmp["summary"]["mae_t5_delta"] == -2.0
    assert cmp["summary"]["dir_t5_delta_pp"] == 5.0
    assert cmp["summary"]["seq_delta_mae_vs_base_change"] == -0.5
