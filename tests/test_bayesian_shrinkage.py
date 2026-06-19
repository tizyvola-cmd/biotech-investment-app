"""Tests for Phase 5 portfolio calibration backend loops."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from prediction import calibration_state as cs
from prediction.bayesian_shrinkage import compute_calibration_snapshot, preview_cycle
from prediction.calibration_buckets import bucket_pplan, bucket_sds, is_win
from prediction.calibration_proposal import diff_snapshot_vs_frozen, preview_cycle as proposal_preview
from prediction.learning_loop_actions import apply_loop, preview_loop, reset_loop


@pytest.fixture()
def isolated_calibration(monkeypatch, tmp_path: Path):
    fw = tmp_path / "fw.json"
    prop = tmp_path / "prop.json"
    feat = tmp_path / "feat.json"
    hist = tmp_path / "hist.json"
    af = tmp_path / "af.json"
    monkeypatch.setattr(cs, "FROZEN_WEIGHTS_PATH", fw)
    monkeypatch.setattr(cs, "PROPOSALS_PATH", prop)
    monkeypatch.setattr(cs, "FEATURE_SNAPSHOTS_PATH", feat)
    monkeypatch.setattr(cs, "SHRINKAGE_HISTORY_PATH", hist)
    monkeypatch.setattr(cs, "ADVICE_FEEDBACK_PATH", af)
    yield tmp_path


def test_bucket_helpers():
    assert bucket_sds(35) == "SDS <40 (Low)"
    assert bucket_pplan(55) == "P(plan) 50-70%"
    assert is_win({"pnl_pct": 3.0})
    assert not is_win({"pnl_pct": -3.0})


def test_compute_snapshot_empty():
    snap = compute_calibration_snapshot([])
    assert snap["totalTrades"] == 0
    assert snap["globalPrior"] == 0.5


def test_preview_bayesian_shrinkage_loop(isolated_calibration):
    doc = preview_loop("bayesian_shrinkage")
    assert doc["ok"] is True
    assert doc["action"] == "preview"


def test_proposal_preview_no_changes(isolated_calibration):
    snap = compute_calibration_snapshot(
        [
            {"ticker": "AAA", "pnl_pct": 5.0, "capital_eur": 1000, "entry_affidabilita_pct": 60},
            {"ticker": "BBB", "pnl_pct": -5.0, "capital_eur": 1000, "entry_affidabilita_pct": 55},
        ]
    )
    frozen = cs.load_frozen_weights()
    changes = diff_snapshot_vs_frozen(snap, frozen)
    assert isinstance(changes, list)


def test_proposal_engine_preview(isolated_calibration):
    doc = proposal_preview()
    assert doc["ok"] is True


def test_apply_proposal_engine_creates_when_no_pending(isolated_calibration, monkeypatch):
    monkeypatch.setattr(
        "prediction.bayesian_shrinkage._closed_outcomes",
        lambda: [
            {"ticker": "AAA", "row_key": "AAA|2026-01-01", "pnl_pct": 8.0, "capital_eur": 2000, "entry_affidabilita_pct": 72, "buy_signal": True},
            {"ticker": "BBB", "row_key": "BBB|2026-02-01", "pnl_pct": 6.0, "capital_eur": 1500, "entry_affidabilita_pct": 68, "buy_signal": True},
            {"ticker": "CCC", "row_key": "CCC|2026-03-01", "pnl_pct": -4.0, "capital_eur": 1200, "entry_affidabilita_pct": 52, "buy_signal": True},
        ],
    )
    doc = apply_loop("proposal_engine", confirm=True)
    assert doc["ok"] is True


def test_reset_bayesian_shrinkage(isolated_calibration):
    doc = reset_loop("bayesian_shrinkage", confirm=True)
    assert doc["ok"] is True


def test_import_from_portfolio_snapshot(isolated_calibration):
    cs.import_from_portfolio_snapshot(
        {
            "frozen_weights": {"updatedAt": "t", "lastProposalId": None, "weights": {"clinicalPhase": {"Phase 3": {"weight": 0.4, "n": 5, "confidence": "medium"}}}},
            "calibration_proposals": [],
            "advice_feedback": {"generatedAt": "t", "scoredPoints": 1, "bucketCorrections": [], "actionDemotions": []},
        }
    )
    fw = cs.load_frozen_weights()
    assert fw["weights"]["clinicalPhase"]["Phase 3"]["weight"] == 0.4
