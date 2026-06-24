"""Tests for SDS Cluster A collector (openFDA unmet need, pipeline value)."""
from __future__ import annotations

from prediction.sds_cluster_a_collector import (
    estimate_pipeline_value_billions,
    heuristic_first_in_class,
    indication_search_phrases,
    phase_success_prob,
    tam_hint_billions,
)
from prediction.supernova_score import unmet_need_score


def count_approved_drugs_from_payload(payload: dict) -> int:
    """Helper mirroring collector logic for unit tests."""
    brands: set[str] = set()
    for row in payload.get("results") or []:
        openfda = row.get("openfda") or {}
        for b in openfda.get("brand_name") or []:
            brands.add(str(b).upper())
    return len(brands)


def test_indication_search_phrases():
    out = indication_search_phrases("Ovarian Cancer, recurrent")
    assert "Ovarian Cancer" in out[0] or out[0].startswith("Ovarian")


def test_count_approved_from_mock_payload():
    payload = {
        "results": [
            {"openfda": {"brand_name": ["DrugA"], "generic_name": ["gena"]}},
            {"openfda": {"brand_name": ["DrugB"], "generic_name": ["gena"]}},
        ]
    }
    assert count_approved_drugs_from_payload(payload) == 2


def test_heuristic_first_in_class_empty_market():
    assert heuristic_first_in_class(approved_count=0, interventions="mab", phase="PHASE3") is True
    assert heuristic_first_in_class(approved_count=5, interventions="mab", phase="PHASE3") is False


def test_unmet_need_with_fic_bonus():
    assert unmet_need_score(0, True, confidence="high") == 13.0
    assert unmet_need_score(2, False) == 7.0


def test_pipeline_value_from_tam():
    val = estimate_pipeline_value_billions(phase="PHASE3", tam_billions=8.0, peak_sales_billions=None)
    assert val is not None
    assert val > 0.4


def test_tam_hint():
    assert tam_hint_billions("NASH / NAFLD") == 8.0
    assert tam_hint_billions("non-alcoholic steatohepatitis") == 8.0


def test_phase_success_prob():
    assert phase_success_prob("PHASE3") >= 0.5
