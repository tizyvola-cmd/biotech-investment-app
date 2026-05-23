"""Tests for safe model-curve imputation (weakness #6)."""
from __future__ import annotations

from prediction.impute import (
    count_pre_cd_nodes,
    count_post_cd_model_nodes,
    impute_pre_cd_gaps_only,
    impute_pre_cd_model_pcts,
    model_curve_is_plottable,
    parse_pct,
    PRE_CD_GRID,
)


def _keys_pre_cd() -> list[str]:
    return [k for _, k in PRE_CD_GRID]


def test_single_t60_zero_no_flat_fill():
    row = {"model_dm60_pct": 0.0}
    impute_pre_cd_model_pcts(row)
    assert row.get("model_dm30_pct") is None
    assert row.get("model_dm10_pct") is None
    assert row.get("model_dm5_pct") is None
    assert row.get("model_dm3_pct") is None
    assert row.get("model_curve_imputed") is False
    assert row.get("model_impute_reason") == "insufficient_nodes"
    assert row.get("model_curve_valid") is False


def test_two_nodes_linear_interpolate_middle():
    row = {"model_dm60_pct": -4.0, "model_dm3_pct": 2.0}
    res = impute_pre_cd_gaps_only(row)
    assert res.imputed is True
    assert row.get("model_dm30_pct") is not None
    assert row.get("model_dm10_pct") is not None
    assert row.get("model_dm5_pct") is not None
    # -30 is between -60 (-4%) and -3 (+2%) on the calendar offset axis
    assert abs(float(row["model_dm30_pct"]) - (-0.8)) < 0.15


def test_complete_nodes_without_gap_fill_is_plottable():
    row = {
        "model_dm60_pct": 0.0,
        "model_dm30_pct": 43.8,
        "model_dm10_pct": 41.5,
        "model_dm5_pct": 41.0,
        "model_dm3_pct": 40.9,
    }
    res = impute_pre_cd_gaps_only(row)
    assert res.imputed is False
    assert res.reason == "complete"
    impute_pre_cd_model_pcts(row)
    assert row.get("model_curve_valid") is True
    assert model_curve_is_plottable(row) is True


def test_post_cd_only_nodes_are_plottable():
    row = {
        "price_at_cd": 12.0,
        "model_dm60_pct": 0.0,
        "model_d4_pct": 18.0,
        "model_d7_pct": 22.0,
    }
    assert count_post_cd_model_nodes(row) == 2
    assert model_curve_is_plottable(row) is True


def test_overlay_prevents_zero_propagation():
    """Sim row Pred −30 fills gap before impute; single T−60=0 stays isolated."""
    pw: dict = {"model_dm60_pct": 0.0}
    # Same logic as _overlay_model_pcts_from_simulation_row when sheet has −30
    if parse_pct(pw.get("model_dm30_pct")) is None:
        pw["model_dm30_pct"] = -2.5
    res = impute_pre_cd_gaps_only(pw)
    assert res.imputed is True
    assert pw.get("model_dm30_pct") == -2.5
    assert pw.get("model_dm10_pct") is not None
