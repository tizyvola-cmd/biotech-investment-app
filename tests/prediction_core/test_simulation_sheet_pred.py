"""Simulation sheet Pred %: seq + blend toward model on run-up (HURA-safe)."""
from __future__ import annotations

import pytest

import data_orchestrator as orch
from prediction.extrap_safeguards import blend_sheet_display_seq_model


@pytest.fixture
def hura_like_pred():
    return {
        "model_dm60_pct": -11.7,
        "model_dm30_pct": -1.0,
        "model_dm10_pct": -2.7,
        "model_dm5_pct": -2.9,
        "model_d7_pct": -3.6,
        "d5_pct": -3.5,
        "price_at_cd": 2.31,
        "run_up_30d": 35.0,
        "seq_curve_pct_vs_m60": [0.0, 43.21, 43.11, 43.11, 43.11, 43.11, 43.11, 43.01],
        "seq_curve_t60_usd": 1.62,
    }


def test_blend_pulls_hura_t30_toward_model(monkeypatch):
    monkeypatch.setenv("SIMULATION_SEQ_BLEND_TO_MODEL", "1")
    seq = [0.0, 43.21, 43.11, 43.11, 43.11, 43.11, 43.11, 43.01]
    model = [0.0, -1.0, -2.7, -2.9, -2.9, -3.0, -3.6, -3.6]
    out = blend_sheet_display_seq_model(seq, model, pred_row={"run_up_30d": 35})
    assert out[1] is not None
    assert float(out[1]) < 15.0
    assert float(out[1]) != pytest.approx(43.21, abs=2.0)


def test_simulation_sheet_blend_on_not_raw_seq_runup(monkeypatch, hura_like_pred):
    monkeypatch.delenv("SIMULATION_SHEET_USE_MODEL_ONLY", raising=False)
    monkeypatch.setenv("SIMULATION_SEQ_BLEND_TO_MODEL", "1")
    pw = dict(hura_like_pred)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    pts = orch._simulation_sheet_pred_pct_vs_m60(hura_like_pred, pw)
    assert pts[1] is not None
    assert abs(float(pts[1])) < 20.0
    assert float(pts[1]) != pytest.approx(43.21, abs=3.0)


def test_simulation_sheet_raw_seq_when_blend_off(monkeypatch, hura_like_pred):
    monkeypatch.setenv("SIMULATION_SEQ_BLEND_TO_MODEL", "0")
    pw = dict(hura_like_pred)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    pts = orch._simulation_sheet_pred_pct_vs_m60(hura_like_pred, pw)
    assert pts[1] == pytest.approx(43.21, abs=0.1)


def test_simulation_sheet_model_only_opt_out(monkeypatch, hura_like_pred):
    monkeypatch.setenv("SIMULATION_SHEET_USE_MODEL_ONLY", "1")
    pw = dict(hura_like_pred)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    pts = orch._simulation_sheet_pred_pct_vs_m60(hura_like_pred, pw)
    assert float(pts[1]) != pytest.approx(43.21, abs=3.0)


def test_post_cd_keeps_realized_history(monkeypatch, hura_like_pred):
    """T+4 già passato: resta il valore ricalibrato, non il modello."""
    from datetime import date

    from prediction.live_recalib_sheet import merge_pred_display_historical_and_model

    monkeypatch.setenv("SIMULATION_POST_CD_MODEL_DISPLAY", "1")
    cd = date(2026, 1, 1)
    today = date(2026, 2, 1)
    display = [0.0, 43.0, 43.0, 43.0, 43.0, 43.0, 55.5, 56.0]
    model = [0.0, -1.0, -2.0, -2.0, -2.0, -3.0, 10.0, 12.0]
    out = merge_pred_display_historical_and_model(
        display,
        model,
        cd,
        today=today,
    )
    assert out[6] == pytest.approx(55.5, abs=0.01)


def test_post_cd_uses_model_not_seq_plateau(monkeypatch, hura_like_pred):
    from datetime import date

    from prediction.live_recalib_sheet import merge_pred_display_historical_and_model

    monkeypatch.setenv("SIMULATION_POST_CD_MODEL_DISPLAY", "1")
    pw = dict(hura_like_pred)
    orch._accuracy_sim_impute_missing_pre_cd_model_pcts(pw)
    model = orch._interp_pred_pct_vs_m60_calendar(pw, orch.SIMULATION_PRED_CAL_OFFSETS)
    cd = date(2026, 12, 1)
    today = date(2026, 5, 20)
    out = merge_pred_display_historical_and_model(
        hura_like_pred["seq_curve_pct_vs_m60"],
        model,
        cd,
        today=today,
    )
    assert float(out[6]) != pytest.approx(43.11, abs=2.0)
    assert float(out[6]) < 25.0


def test_accuracy_sheet_keeps_raw_seq_by_default(monkeypatch, hura_like_pred):
    monkeypatch.delenv("ACCURACY_SEQ_BLEND_TO_MODEL", raising=False)
    monkeypatch.delenv("SIMULATION_SEQ_BLEND_TO_MODEL", raising=False)
    pw = dict(hura_like_pred)
    pts = orch._sheet_blended_pred_pct_vs_m60(hura_like_pred, pw, accuracy=True)
    assert pts[1] == pytest.approx(43.21, abs=0.1)
