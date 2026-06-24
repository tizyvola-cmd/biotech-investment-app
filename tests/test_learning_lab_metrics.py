"""Counterfactual layer metrics for Learning Lab weekly history."""
from __future__ import annotations

import pytest

from prediction.learning_lab import compute_counterfactual_layer_metrics


def _unity_cluster_blend(_g=None):
    from prediction.cluster_cal_factor import TICKER_CLUSTERS

    return {name: 1.0 for name in list(TICKER_CLUSTERS.keys()) + ["other"]}


def _unity_regime_mult():
    return {"RISK_ON": 1.0, "NEUTRAL": 1.0, "RISK_OFF": 1.0}


def test_counterfactual_baseline_matches_raw_mae(monkeypatch):
    monkeypatch.setattr("prediction.learning_lab.get_global_cal_factor", lambda: 1.0)
    monkeypatch.setattr("prediction.cluster_cal_factor.build_cluster_blend_map", _unity_cluster_blend)
    monkeypatch.setattr("prediction.regime_calibration.build_regime_multiplier_map", _unity_regime_mult)
    outcomes = [
        {"pred": 5.0, "actual": 3.0, "ticker_data": {"phase": "Phase 3", "condition": "oncology"}},
        {"pred": -2.0, "actual": 1.0, "ticker_data": {"phase": "Phase 2", "condition": "rare"}},
    ]
    m = compute_counterfactual_layer_metrics(outcomes, regime_outcomes=[])
    assert m["mae_baseline"] == 2.5
    assert m["mae_with_all"] == 2.5
    assert m["dir_before_cluster"] == 0.5


def test_cluster_layer_can_change_mae(monkeypatch, tmp_path):
    import prediction.cluster_cal_factor as cluster_mod

    monkeypatch.setattr("prediction.learning_lab.get_global_cal_factor", lambda: 1.0)
    monkeypatch.setattr("prediction.regime_calibration.build_regime_multiplier_map", _unity_regime_mult)

    def _onc_blend(_g=None):
        m = _unity_cluster_blend(_g)
        m["phase3_oncology"] = 0.5
        return m

    monkeypatch.setattr(cluster_mod, "build_cluster_blend_map", _onc_blend)

    outcomes = [
        {
            "pred": 10.0,
            "actual": 5.0,
            "ticker_data": {"phase": "Phase 3", "condition": "lung cancer"},
        }
    ]
    m = compute_counterfactual_layer_metrics(outcomes, regime_outcomes=[])
    assert m["mae_baseline"] == 5.0
    assert m["mae_after_cluster"] == 0.0
    assert m["mae_with_all"] == 0.0


def test_regime_metrics_use_main_pool_when_regime_store_tiny(monkeypatch):
    monkeypatch.setattr("prediction.learning_lab.get_global_cal_factor", lambda: 1.0)
    monkeypatch.setattr("prediction.cluster_cal_factor.build_cluster_blend_map", _unity_cluster_blend)
    monkeypatch.setattr("prediction.regime_calibration.build_regime_multiplier_map", _unity_regime_mult)
    outcomes = [
        {"pred": 5.0, "actual": 3.0, "date": "2026-01-15", "ticker_data": {}},
        {"pred": -2.0, "actual": 1.0, "date": "2026-02-01", "ticker_data": {}},
    ] * 8
    tiny_regime = [{"pred": 3.0, "actual": 8.0, "regime": "NEUTRAL"}]
    m = compute_counterfactual_layer_metrics(outcomes, regime_outcomes=tiny_regime)
    assert m["n_regime_outcomes"] == 16
    assert m["mae_after_regime"] == 2.5
    assert m["dir_after_regime"] == 0.5


def test_sanitize_week_metrics_backfills_missing_dir_layers():
    from prediction.learning_lab import _sanitize_week_metrics

    row = _sanitize_week_metrics(
        {
            "week": "2026-06-15",
            "n_outcomes": 120,
            "n_regime_outcomes": 120,
            "dir_before_regime": 0.51,
            "dir_after_regime": 0.52,
        }
    )
    assert row["dir_after_cluster"] == 0.51
    assert row["dir_with_all"] == 0.52


def test_build_effectiveness_ignores_low_n_history_week(monkeypatch, tmp_path):
    from prediction import learning_lab as lab

    hist_path = tmp_path / "learning_history.json"
    hist_path.write_text(
        '{"weeks":[{"week":"2026-05-31","n_outcomes":120,"mae_with_all":2.6,"dir_with_all":0.52},'
        '{"week":"2026-06-15","n_outcomes":1,"mae_with_all":4.76,"dir_with_all":1.0}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(lab, "LEARNING_HISTORY_JSON", str(hist_path))
    monkeypatch.setattr(
        lab,
        "collect_resolved_outcomes_from_sources",
        lambda: [{"pred": 1.0, "actual": 2.0, "ticker_data": {}}] * 20,
    )
    monkeypatch.setattr(lab, "resolve_regime_outcomes_for_learning", lambda _o=None: [])
    monkeypatch.setattr(
        lab,
        "compute_counterfactual_layer_metrics",
        lambda _o, _r=None: {
            "n_outcomes": 20,
            "n_regime_outcomes": 20,
            "mae_with_all": 7.3,
            "dir_with_all": 0.5,
            "mae_after_cluster": 7.1,
            "dir_after_cluster": 0.51,
            "mae_before_regime": 7.2,
            "mae_after_regime": 7.0,
            "dir_before_regime": 0.49,
            "dir_after_regime": 0.52,
            "mae_baseline": 7.4,
        },
    )
    monkeypatch.setattr(
        "prediction.cd_pattern_polygon_accuracy.load_cd_pattern_polygon_accuracy",
        lambda: {"n_samples": 0, "effectiveness": {}, "learning_history": []},
    )
    monkeypatch.setattr(
        "prediction.eis_super_score_learning.build_eis_super_score_overview",
        lambda: {"n_events_scored": 0, "effectiveness": {}, "learning_history": []},
    )
    monkeypatch.setattr(lab, "load_validation_feedback_snippet", lambda: {"summary": None, "history": []})
    monkeypatch.setattr(lab, "load_signal_calibration_snippet", lambda: {"weekly_actionable": [], "useful_n": 0})
    monkeypatch.setattr(lab, "load_curve_impact_snippet", lambda: {"n_events": 0, "summary": {}})

    rows = lab.build_effectiveness_delta()
    global_cf = next(r for r in rows if r["mechanism"] == "global_cf")
    assert global_cf["n"] == 20
    assert global_cf["mae_after"] == 7.3
    assert global_cf["dir_after"] == 0.5
    assert global_cf["verdict"] == "collecting_data"
    cluster_cf = next(r for r in rows if r["mechanism"] == "cluster_cf")
    # cluster layer cut MAE 7.4 -> 7.1 = -0.3pp lift: within noise band -> neutral
    assert cluster_cf["abs_lift_pp"] == -0.3
    assert cluster_cf["verdict"] == "neutral"


def test_verdict_noise_band_and_abs_lift():
    from prediction.learning_lab import _verdict

    n, mn = 50, 15
    # MAE worse beyond noise -> not helping (even if WoW delta looks fine)
    assert _verdict(0.8, -2.0, None, n, mn) == "not_helping"
    # tiny positive lift within noise band -> neutral, not not_helping
    assert _verdict(0.2, 5.0, None, n, mn) == "neutral"
    # modest real reduction -> learning
    assert _verdict(-0.6, 0.0, None, n, mn) == "learning"
    # strong real reduction -> improving
    assert _verdict(-1.5, 0.0, None, n, mn) == "improving"
    # no abs lift -> fall back to week-over-week delta
    assert _verdict(None, 0.9, None, n, mn) == "not_helping"
    # below min sample -> collecting
    assert _verdict(-2.0, -2.0, None, 5, mn) == "collecting_data"


def test_verdict_corr_noise_band():
    from prediction.learning_lab import _verdict_corr

    n, mn = 30, 10
    assert _verdict_corr(-8.8, n, mn) == "not_helping"
    assert _verdict_corr(0.5, n, mn) == "neutral"  # was "learning" before noise band
    assert _verdict_corr(2.5, n, mn) == "learning"
    assert _verdict_corr(5.0, n, mn) == "improving"
