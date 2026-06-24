"""Tests for learning_loop_actions (Phase 4)."""

from __future__ import annotations

from prediction.learning_loop_actions import apply_loop, preview_loop, reset_loop


def test_preview_unknown_loop():
    doc = preview_loop("not_a_real_loop_xyz")
    assert doc["ok"] is False
    assert doc["error"] == "unknown_loop"


def test_preview_bayesian_shrinkage_runs():
    doc = preview_loop("bayesian_shrinkage")
    assert doc["ok"] is True
    assert doc["action"] == "preview"
    assert "changes" in doc


def test_preview_proposal_engine_runs():
    doc = preview_loop("proposal_engine")
    assert doc["ok"] is True
    assert doc["action"] == "preview"


def test_preview_frontend_only_ra():
    doc = preview_loop("ra_calibration")
    assert doc["ok"] is False
    assert doc["error"] == "frontend_only"


def test_preview_cluster_cf_runs():
    doc = preview_loop("cluster_cf")
    assert doc["ok"] is True
    assert doc["action"] == "preview"
    assert "changes" in doc


def test_apply_requires_confirm():
    doc = apply_loop("cluster_cf", confirm=False)
    assert doc["ok"] is False
    assert doc["error"] == "confirm_required"


def test_reset_requires_confirm():
    doc = reset_loop("portfolio_error_loop", confirm=False)
    assert doc["ok"] is False
