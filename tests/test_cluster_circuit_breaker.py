"""The general circuit breaker must also guard cluster cal_factors."""
from __future__ import annotations

import json

from prediction import cluster_cal_factor as cc


def test_cluster_breaker_freezes_diverging_factor(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"cluster_cal_factors": {"phase1_2_early": 0.95}, "mae_after_cluster": 7.1, "mae_baseline": 7.2},
            {"cluster_cal_factors": {"phase1_2_early": 0.85}, "mae_after_cluster": 7.6, "mae_baseline": 7.2},
            {"cluster_cal_factors": {"phase1_2_early": 0.75}, "mae_after_cluster": 7.9, "mae_baseline": 7.2},
        ]
    }
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(cc, "LEARNING_HISTORY_JSON", str(lh))

    cb = cc._circuit_breaker_for_cluster("phase1_2_early", 0.71)
    assert cb.triggered is True
    # last non-degraded historical value was 0.95 (first week beat baseline)
    assert cb.value == 0.95


def test_cluster_breaker_passes_when_helping(monkeypatch, tmp_path):
    weeks = {
        "weeks": [
            {"cluster_cal_factors": {"phase2_oncology": 1.05}, "mae_after_cluster": 7.0, "mae_baseline": 7.2},
            {"cluster_cal_factors": {"phase2_oncology": 1.10}, "mae_after_cluster": 6.9, "mae_baseline": 7.2},
            {"cluster_cal_factors": {"phase2_oncology": 1.15}, "mae_after_cluster": 6.8, "mae_baseline": 7.2},
        ]
    }
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(cc, "LEARNING_HISTORY_JSON", str(lh))

    cb = cc._circuit_breaker_for_cluster("phase2_oncology", 1.2)
    assert cb.triggered is False
    assert cb.value == 1.2
