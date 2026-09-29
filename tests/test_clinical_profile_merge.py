"""Deep pass must fill sparse study_clinical_profile fields, not keep the first dict."""

from clinical_pre_cd_enrichment import _merge_ai_kpi_payload, _merge_study_profiles


def test_merge_ai_kpi_fills_sparse_profile_from_deep():
    base = {
        "study_clinical_profile": {
            "product_name": "azenosertib",
            "mechanism_of_action": "N/D",
            "disease_soc": {
                "disease": "platinum-resistant ovarian cancer",
                "source_note": "NCCN lists several options",
                "usa_prevalence": "N/D",
                "soc_name": "N/D",
            },
        },
        "clinical_indicators": [],
    }
    deep = {
        "study_clinical_profile": {
            "mechanism_of_action": "Selective WEE1 kinase inhibitor; impairs G2/M checkpoint",
            "disease_soc": {
                "usa_prevalence": "~20k new ovarian cases/yr US",
                "soc_name": "PLD / topotecan / weekly paclitaxel ± bevacizumab",
                "soc_efficacy_benchmark": "ORR ~20–30%",
                "life_expectancy": "median OS ~12 months in PROC",
                "symptoms": "abdominal pain, bloating, ascites",
            },
        },
        "clinical_indicators": [],
    }
    merged = _merge_ai_kpi_payload(base, deep)
    prof = merged["study_clinical_profile"]
    assert "WEE1" in prof["mechanism_of_action"]
    assert prof["product_name"] == "azenosertib"
    soc = prof["disease_soc"]
    assert "20k" in soc["usa_prevalence"]
    assert "PLD" in soc["soc_name"]
    assert "ORR" in soc["soc_efficacy_benchmark"]
    assert "abdominal" in soc["symptoms"]
    assert "NCCN" in soc["source_note"]


def test_merge_study_profiles_keeps_prev_when_new_is_nd():
    prev = {
        "mechanism_of_action": "WEE1 inhibitor",
        "disease_soc": {"soc_name": "PLD", "usa_prevalence": "~20k"},
    }
    new = {
        "mechanism_of_action": "N/D",
        "disease_soc": {"soc_name": "N/D", "symptoms": "bloating"},
    }
    out = _merge_study_profiles(prev, new)
    assert out["mechanism_of_action"] == "WEE1 inhibitor"
    assert out["disease_soc"]["soc_name"] == "PLD"
    assert out["disease_soc"]["symptoms"] == "bloating"
