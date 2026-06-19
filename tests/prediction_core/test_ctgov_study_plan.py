"""Tests for CT.gov study plan extraction (Cluster A)."""
from __future__ import annotations

from prediction.sds.ctgov_study_plan import (
    extract_study_plan_fields,
    nct_from_sim_row,
    normalize_nct_id,
    trial_design_from_study,
)


def test_normalize_nct_from_sim_cell():
    assert normalize_nct_id({"text": "NCT04187560", "href": "https://clinicaltrials.gov/study/NCT04187560"}) == "NCT04187560"
    assert nct_from_sim_row({"NCT": {"text": "NCT04187560"}}) == "NCT04187560"


def test_extract_study_plan_fields_mock():
    study = {
        "protocolSection": {
            "identificationModule": {"nctId": "NCT04187560", "briefTitle": "LB-102 Study"},
            "statusModule": {"overallStatus": "COMPLETED"},
            "outcomesModule": {
                "primaryOutcomes": [
                    {"measure": "Overall Survival", "timeFrame": "24 months"},
                ],
                "secondaryOutcomes": [
                    {"measure": "Progression-free survival", "timeFrame": "12 months"},
                ],
            },
            "designModule": {
                "phases": ["PHASE3"],
                "designInfo": {
                    "allocation": "RANDOMIZED",
                    "interventionModel": "PARALLEL",
                    "maskingInfo": {"masking": "DOUBLE"},
                },
            },
            "conditionsModule": {"conditions": ["Colorectal Cancer"]},
            "armsInterventionsModule": {
                "interventions": [{"name": "Drug X"}, {"name": "Placebo"}],
            },
        }
    }
    fields = extract_study_plan_fields(study)
    assert fields["primary_outcome"] == "Overall Survival"
    assert "Colorectal" in (fields["conditions"] or "")
    assert fields["phase"] == "PHASE3"
    assert "placebo" in (fields["trial_design"] or "").lower()
    assert "randomized" in (fields["trial_design"] or "").lower()


def test_trial_design_from_study():
    study = {
        "protocolSection": {
            "designModule": {
                "designInfo": {"allocation": "RANDOMIZED", "maskingInfo": {"masking": "QUADRUPLE"}},
            },
            "armsInterventionsModule": {"interventions": [{"name": "Placebo"}]},
        }
    }
    label = trial_design_from_study(study)
    assert label and "placebo" in label.lower()
