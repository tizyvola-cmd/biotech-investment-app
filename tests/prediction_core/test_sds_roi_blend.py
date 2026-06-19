"""Tests for SDS multi-curve ROI blend."""
from __future__ import annotations

from prediction.sds_roi_blend import (
    CURVE_OFFSETS,
    cluster_scenario_bonuses,
    compute_curve_roi_blend,
    fit_pct_from_rmse,
    horizon_roi_pp,
    load_reference_curves,
    obs_curve_from_sim_row,
    rmse_pp_vs_ref,
    scenario_weights,
)


def test_fit_pct_from_rmse():
    assert fit_pct_from_rmse(18.0) == 82.0
    assert fit_pct_from_rmse(None) is None


def test_rmse_perfect_fit():
    ref = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 55.0, 60.0]
    obs = list(ref)
    rmse, n = rmse_pp_vs_ref(obs, ref)
    assert rmse == 0.0
    assert n == len(CURVE_OFFSETS)


def test_obs_curve_from_sim_row_fuzzy_columns():
    row = {
        "Completion Date": "2026-06-30",
        "Δ% vs Pred−60\nPred\n−30": "12.5",
        "Δ% vs Pred−60\nPred\n−10": "25",
        "Δ% vs Pred−60\nPred\n−7": "30%",
        "Δ% vs Pred−60\nPred\n−5": "35",
        "Δ% vs Pred−60\nPred\n−3": "40",
        "Δ% vs Pred−60\nPred\n+4": "38",
        "Δ% vs Pred−60\nPred\n+7": "42",
    }
    obs = obs_curve_from_sim_row(row)
    assert obs[1] == 12.5
    assert obs[2] == 25.0
    assert obs[6] == 38.0


def test_compute_curve_roi_blend_minimal():
    refs = load_reference_curves()
    row = {
        "Completion Date": "2026-06-30",
        **{
            f"Δ% vs Pred−60\nPred\n{'+' + str(off) if off > 0 else '−' + str(abs(off))}": str(i * 10)
            for i, off in enumerate(CURVE_OFFSETS)
        },
    }
    out = compute_curve_roi_blend(row, sds=72, refs=refs)
    assert out is not None
    assert out["best_profile"] is not None
    assert out["best_fit_pct"] is not None
    hz = out.get("horizons") or {}
    assert "pre_10" in hz or "pre_5" in hz or "post_4" in hz
    for key in ("pre_10", "pre_5", "post_4"):
        if key in hz:
            assert "pct_vs_m60" in hz[key]


def test_scenario_weights_favor_cluster1_at_high_sds():
    fit = {pid: 50.0 for pid in ("cluster1", "cluster0", "post_rialzo", "post_ribasso", "post_neutro")}
    w_low = scenario_weights(fit, sds=40, obs_n=0)
    w_high = scenario_weights(fit, sds=80, obs_n=0)
    assert w_high.get("cluster1", 0) > w_low.get("cluster1", 0)


def test_horizon_roi_forward_delta():
    refs = {"cluster1": [0.0, 10.0, 20.0, 25.0, 30.0, 32.0, 33.0, 35.0]}
    obs = list(refs["cluster1"])
    weights = {"cluster1": 1.0}
    # now at -10, +5 calendar days -> -5
    roi = horizon_roi_pp(obs, refs, weights, -10, -5)
    assert roi == 10.0


def test_cluster_bonuses_favor_post_rialzo_on_squeeze():
    fit = {pid: 50.0 for pid in ("cluster1", "cluster0", "post_rialzo", "post_ribasso", "post_neutro")}
    item = {
        "cluster_b": {"short_interest": {"squeeze_setup": True}},
        "cluster_scores": {"catalyst_quality": 25, "institutional_signal": 16},
        "days_to_cd": 30,
    }
    bonuses = cluster_scenario_bonuses(item)
    assert bonuses.get("post_rialzo", 0) >= 8
    w = scenario_weights(fit, sds=70, obs_n=0, cluster_bonuses=bonuses)
    w_plain = scenario_weights(fit, sds=70, obs_n=0)
    assert w.get("post_rialzo", 0) >= w_plain.get("post_rialzo", 0)
