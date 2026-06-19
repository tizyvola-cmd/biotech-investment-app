"""Tests for cluster cal_factor classification."""
from prediction.cluster_cal_factor import (
    apply_cluster_cal_factor,
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
