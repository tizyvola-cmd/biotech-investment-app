"""Tests for cluster cal_factor classification."""
import prediction.cluster_cal_factor as ccf
from prediction.cluster_cal_factor import (
    apply_cluster_cal_factor,
    blended_cluster_cal_factor,
    classify_ticker,
    normalize_phase_text,
)


def test_normalize_phase_ctgov_style():
    assert normalize_phase_text("PHASE2") == "phase 2"
    assert normalize_phase_text("PHASE1 | PHASE2") == "phase 1 phase 2"
    assert normalize_phase_text("Phase 1/2") == "phase 1 2"


def test_classify_phase2_oncology():
    td = {"phase": "Phase 2", "condition": "Non-small cell lung cancer"}
    assert classify_ticker(td) == "phase2_oncology"


def test_classify_phase2_ctgov_without_indication():
    assert classify_ticker({"phase": "PHASE2", "condition": ""}) == "phase2_oncology"


def test_classify_phase1_ctgov():
    assert classify_ticker({"phase": "PHASE1", "condition": ""}) == "phase1_2_early"


def test_classify_phase3_pipe_separated():
    assert classify_ticker({"phase": "PHASE2 | PHASE3", "condition": ""}) == "phase2_oncology"


def test_classify_pdufa():
    td = {"phase": "PDUFA", "condition": "Any disease"}
    assert classify_ticker(td) == "pdufa_regulatory"


def test_classify_other():
    assert classify_ticker({"phase": "Unknown", "condition": ""}) == "other"


def _patch_factors(monkeypatch, entry):
    monkeypatch.setattr(ccf, "load_cluster_cal_factors", lambda: {"phase3_oncology": entry})
    monkeypatch.setattr(ccf, "get_global_cal_factor", lambda: 1.0)


def test_blended_returns_neutral_below_apply_threshold(monkeypatch):
    # Enough to record (>= MIN_SAMPLES) but below the apply threshold -> no correction.
    _patch_factors(
        monkeypatch,
        {"cal_factor": 0.8, "status": "active", "n_samples": 6, "bias_pp": -3.0},
    )
    assert blended_cluster_cal_factor("phase3_oncology") == 1.0


def test_blended_circuit_breaker_on_noise_level_bias(monkeypatch):
    # Plenty of samples but bias within the deadband -> treat as calibrated.
    _patch_factors(
        monkeypatch,
        {"cal_factor": 0.85, "status": "active", "n_samples": 60, "bias_pp": 0.4},
    )
    assert blended_cluster_cal_factor("phase3_oncology") == 1.0


def test_blended_shrinks_toward_one_for_small_samples(monkeypatch):
    # Same raw factor, fewer samples -> result closer to 1.0 (shrinkage).
    base = {"cal_factor": 0.7, "status": "active", "bias_pp": -4.0}
    _patch_factors(monkeypatch, {**base, "n_samples": 60})
    big = blended_cluster_cal_factor("phase3_oncology")
    _patch_factors(monkeypatch, {**base, "n_samples": 13})
    small = blended_cluster_cal_factor("phase3_oncology")
    assert abs(small - 1.0) < abs(big - 1.0)
    assert ccf.CLUSTER_CF_FLOOR <= big <= ccf.CLUSTER_CF_CEILING
