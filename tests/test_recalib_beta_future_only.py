"""β in ricalibrazione seq_curve / 8-K: solo CD future (storico invariato)."""
from __future__ import annotations

import os
from datetime import date, timedelta

import pandas as pd
import pytest


@pytest.fixture
def orch():
    import data_orchestrator as o

    return o


@pytest.fixture
def beta_on(monkeypatch):
    monkeypatch.setenv("ACC_K8_RECALIB_BETA", "1")
    monkeypatch.setenv("ACC_K8_BETA_FUTURE_ONLY", "1")


def test_beta_applies_only_on_future_cd(orch, beta_on):
    today = date(2026, 5, 15)
    past = today - timedelta(days=10)
    future = today + timedelta(days=10)
    assert not orch._accuracy_recalib_beta_applies_for_cd(past, today=today)
    assert orch._accuracy_recalib_beta_applies_for_cd(future, today=today)
    assert orch._accuracy_recalib_beta_applies_for_cd(today, today=today)


def test_seq_lock_skips_blend_on_past_cd(orch, beta_on):
    today = date(2026, 5, 15)
    past_cd = today - timedelta(days=30)
    raw = [0.0, 5.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0]
    out = orch._seq_curve_act_pct_lock_with_beta(
        8.5,
        raw,
        2,
        beta=2.0,
        cd=past_cd,
        today=today,
    )
    assert out == 8.5


def test_seq_lock_blends_on_future_cd(orch, beta_on):
    today = date(2026, 5, 15)
    future_cd = today + timedelta(days=30)
    raw = [0.0, 5.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0]
    out = orch._seq_curve_act_pct_lock_with_beta(
        8.5,
        raw,
        2,
        beta=2.0,
        cd=future_cd,
        today=today,
    )
    assert out != 8.5
    assert isinstance(out, float)


def test_resolve_beta_from_financial_df(orch, beta_on):
    fin = pd.DataFrame(
        {"symbol": ["ABC", "XYZ"], "beta": [1.5, 0.8]},
    )
    assert orch._resolve_ticker_beta_for_recalib("ABC", None, fin) == 1.5
    assert orch._resolve_ticker_beta_for_recalib("XYZ", None, fin) == 0.8
    assert orch._resolve_ticker_beta_for_recalib("MISS", None, fin) is None


def test_monitor_snapshot_records_beta_policy(orch, beta_on, tmp_path, monkeypatch):
    monkeypatch.setattr(orch, "MODEL_ACCURACY_MONITOR_JSON", str(tmp_path / "mon.json"))
    monkeypatch.setattr(orch, "_model_accuracy_metrics_eligible", lambda _r: False)
    monkeypatch.setattr(orch, "_load_calibration_state", lambda: {})
    monkeypatch.setattr(orch, "_calib_load", lambda: {})
    monkeypatch.setattr(
        orch,
        "_pick_monitor_m2_snap",
        lambda *_a, **_k: (
            {
                "m2_mae_7_pp": 10.0,
                "m2_medae_7_pp": 8.0,
                "m2_n_campioni_7": 5,
                "m2_bias_signed_7_pp": 0.0,
                "m2_hit_rate_d5_pct": 50.0,
                "m2_gap_calib_pp": 1.0,
            },
            "test",
        ),
    )
    snap = orch._accuracy_monitor_append_entry([], snapshot_trigger="test")
    assert snap.get("recalib_beta_enabled") is True
    assert snap.get("recalib_beta_future_only") is True


def test_existing_prediction_core_tests_still_import():
    """Smoke: suite prediction_core resta importabile (nessuna regressione di packaging)."""
    import tests.prediction_core.test_seq_calib  # noqa: F401
    import tests.prediction_core.test_calibration  # noqa: F401
