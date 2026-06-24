"""Global cal_factor robustness: deadband + circuit breaker + clamp.

The global layer has a large sample (no shrinkage), so the apply-side guards
only neutralise negligible scaling near 1.0 and freeze a value that keeps
drifting away from neutral while the global layer degrades MAE vs the
pre-global baseline.
"""
from __future__ import annotations

import json

from prediction import cluster_cal_factor as cc


def _patch_history(monkeypatch, tmp_path, weeks: dict) -> None:
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(cc, "LEARNING_HISTORY_JSON", str(lh))


def test_deadband_neutralises_negligible_scaling(monkeypatch):
    monkeypatch.setattr(cc, "get_global_cal_factor", lambda: 1.015)
    assert cc.robust_global_cal_factor() == 1.0


def test_clamp_bounds_extreme_factor(monkeypatch, tmp_path):
    _patch_history(monkeypatch, tmp_path, {"weeks": []})
    monkeypatch.setattr(cc, "get_global_cal_factor", lambda: 1.6)
    assert cc.robust_global_cal_factor() == cc.GLOBAL_CF_CEILING


def test_breaker_freezes_diverging_global(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"global_cal_factor": 1.05, "mae_with_all": 7.1, "mae_global_before": 7.2},
            {"global_cal_factor": 1.15, "mae_with_all": 7.6, "mae_global_before": 7.2},
            {"global_cal_factor": 1.25, "mae_with_all": 7.9, "mae_global_before": 7.2},
        ]
    }
    _patch_history(monkeypatch, tmp_path, weeks)
    cb = cc._circuit_breaker_for_global(1.30)
    assert cb.triggered is True
    assert cb.value == 1.05  # last non-degraded historical value

    monkeypatch.setattr(cc, "get_global_cal_factor", lambda: 1.30)
    assert cc.robust_global_cal_factor() == 1.05


def test_breaker_passes_when_helping(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"global_cal_factor": 1.05, "mae_with_all": 7.0, "mae_global_before": 7.2},
            {"global_cal_factor": 1.15, "mae_with_all": 6.9, "mae_global_before": 7.2},
            {"global_cal_factor": 1.25, "mae_with_all": 6.8, "mae_global_before": 7.2},
        ]
    }
    _patch_history(monkeypatch, tmp_path, weeks)
    cb = cc._circuit_breaker_for_global(1.28)
    assert cb.triggered is False

    monkeypatch.setattr(cc, "get_global_cal_factor", lambda: 1.28)
    assert cc.robust_global_cal_factor() == 1.28
