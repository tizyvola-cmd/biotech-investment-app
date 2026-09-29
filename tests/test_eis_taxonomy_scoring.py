"""Tests for taxonomy-based intrinsic news scoring."""
from __future__ import annotations

import pytest

from eis_taxonomy_scoring import (
    classify_heuristic,
    compute_dimension_score,
    load_taxonomy,
    score_article_dimensions,
)


def test_taxonomy_loads():
    load_taxonomy.cache_clear()
    tax = load_taxonomy()
    # v9: + CLIN_SCIENTIFIC_PUBLICATION + company_affiliation_match
    assert tax["version"] == 9
    assert len(tax["events"]) == 64
    assert len(tax["modifiers"]) == 20
    assert any(e["id"] == "CLIN_PRIMARY_MET" for e in tax["events"])
    assert any(e["id"] == "CLIN_STUDY_COMPLETED" for e in tax["events"])
    assert any(e["id"] == "CLIN_STUDY_SUCCESS" for e in tax["events"])
    assert any(e["id"] == "CLIN_STUDY_FAILED" for e in tax["events"])
    assert any(e["id"] == "CLIN_DOSING_MILESTONE" for e in tax["events"])
    assert any(e["id"] == "CLIN_SCIENTIFIC_PUBLICATION" for e in tax["events"])
    assert any(m["id"] == "company_affiliation_match" for m in tax["modifiers"])
    assert any(e["id"] == "FIN_DILUTIVE_OFFERING" for e in tax["events"])
    assert any(e["id"] == "FIN_EARNINGS_REPORTED" for e in tax["events"])
    study = next(e for e in tax["events"] if e["id"] == "CLIN_STUDY_COMPLETED")
    dosing = next(e for e in tax["events"] if e["id"] == "CLIN_DOSING_MILESTONE")
    assert float(dosing["base_weight"]) == pytest.approx(
        float(study["base_weight"]) * 0.1, abs=1e-9
    )
    mods = {m["id"]: float(m["multiplier"]) for m in tax["modifiers"]}
    assert mods["trial_phase_phase1"] < mods["trial_phase_phase2"]
    assert mods["trial_phase_phase2"] < mods["trial_phase_phase3"]
    assert mods["trial_phase_phase3"] < mods["trial_phase_phase4"]
    assert mods["trial_phase_phase4"] < mods["trial_phase_post_market"]


def test_deterministic_formula_primary_endpoint_phase3_p001():
    # base 2.5 × fase3 1.0 × p<0.01 1.15 = 2.875
    r = compute_dimension_score(
        "CLIN_PRIMARY_MET",
        ["trial_phase_phase3", "statistical_significance_p_lt_0_01"],
    )
    assert r["score"] == 2.88  # clamped/rounded
    assert r["base_weight"] == 2.5
    assert abs(float(r["raw_score"]) - 2.5 * 1.0 * 1.15) < 1e-3


def test_legacy_snake_id_alias_resolves():
    r = compute_dimension_score(
        "clinical_endpoint_primario_centrato_significativo",
        ["fase_trial_fase_3_pivotal"],
    )
    assert r["event_id"] == "CLIN_PRIMARY_MET"
    assert r["score"] != 0.0


def test_unknown_event_review_flag():
    r = compute_dimension_score("not_a_real_event_id", [])
    assert r["score"] == 0.0
    assert r["review_flag"] is True
    assert r["review_reason"] == "event_not_in_taxonomy"


def test_no_event_is_neutral_zero():
    r = compute_dimension_score(None, [])
    assert r["score"] == 0.0
    assert r["unclassified"] is True


def test_reproducibility_same_event_same_score():
    a = (
        "Company met the primary endpoint with statistical significance (p<0.001) "
        "in a Phase 3 pivotal study of DrugX."
    )
    b = (
        "In its Phase 3 pivotal trial, the company met the primary endpoint "
        "with statistical significance (p<0.001)."
    )
    sa = score_article_dimensions(a, use_ai=False)
    sb = score_article_dimensions(b, use_ai=False)
    assert sa["clinical_score"] == sb["clinical_score"]
    assert (
        sa["taxonomy_dimensions"]["clinical"]["event_id"]
        == sb["taxonomy_dimensions"]["clinical"]["event_id"]
        == "CLIN_PRIMARY_MET"
    )


SAMPLES = [
    (
        "clin_pos",
        "Acme Therapeutics announced Phase 3 topline results: the study met the "
        "primary endpoint with statistical significance (p<0.001).",
        "clinical",
        "CLIN_PRIMARY_MET",
        True,
    ),
    (
        "clin_neg",
        "The company failed to meet the primary endpoint in its pivotal Phase 3 trial.",
        "clinical",
        "CLIN_PRIMARY_MISSED",
        False,
    ),
    (
        "clin_crl",
        "FDA issued a Complete Response Letter (CRL) for the NDA.",
        "clinical",
        "CLIN_CRL_RECEIVED",
        False,
    ),
    (
        "fin_dilutive",
        "The company priced a dilutive public offering of common stock at a discount.",
        "financial",
        "FIN_DILUTIVE_OFFERING",
        False,
    ),
    (
        "fin_shelf",
        "The company filed a shelf registration statement with the SEC.",
        "financial",
        "FIN_SHELF_FILED",
        None,  # neutral 0
    ),
    (
        "corp_ma",
        "BigPharma agreed to acquire TargetCo for $2.1 billion in an all-cash tender offer.",
        "corporate",
        "CORP_MNA_TARGET_PREMIUM",
        True,
    ),
    (
        "corp_license",
        "The companies entered a licensing agreement with a $50M upfront payment.",
        "corporate",
        "CORP_PARTNERSHIP_SIGNED",
        True,
    ),
    (
        "access_formulary",
        "DrugX was added to the national formulary of major payers.",
        "market_access",
        "ACCESS_FORMULARY_INCLUSION",
        True,
    ),
    (
        "access_hta_neg",
        "NICE decided not to recommend the therapy for routine use.",
        "market_access",
        "ACCESS_HTA_UNFAVORABLE",
        False,
    ),
    (
        "neutral_conf",
        "Management will present at the upcoming investor conference next week.",
        None,
        None,
        None,
    ),
]


def test_sample_articles_classification_and_sign():
    unclassified = []
    for name, text, dim, event_id, positive in SAMPLES:
        scored = score_article_dimensions(text, use_ai=False)
        if dim is None:
            # No strong taxonomy hit expected
            hits = [
                d
                for d, b in (scored.get("taxonomy_dimensions") or {}).items()
                if b.get("event_id")
            ]
            if hits:
                # Conference promo should stay unclassified; record if not
                unclassified.append((name, "unexpected", hits))
            continue
        block = (scored.get("taxonomy_dimensions") or {}).get(dim) or {}
        assert block.get("event_id") == event_id, (
            f"{name}: expected {event_id}, got {block.get('event_id')} "
            f"score={block.get('score')}"
        )
        score = float(block.get("score") or 0)
        if positive is True:
            assert score > 0, name
        elif positive is False:
            assert score < 0, name
        else:
            assert score == 0.0, name
        # Re-run for reproducibility
        scored2 = score_article_dimensions(text, use_ai=False)
        assert scored[f"{dim}_score" if dim != "market_access" else "market_access_score"] == (
            scored2[f"{dim}_score" if dim != "market_access" else "market_access_score"]
        )


def test_corporate_isolated_from_financial():
    text = (
        "BigPharma agreed to acquire TargetCo for $2.1 billion in an all-cash tender offer."
    )
    scored = score_article_dimensions(text, use_ai=False)
    assert scored["corporate_score"] > 0
    assert scored["financial_score"] == 0.0


def test_heuristic_evidence_saved():
    text = "FDA issued a Complete Response Letter (CRL) for the NDA of DrugX."
    c = classify_heuristic(text)
    clin = c["dimensions"]["clinical"]
    assert clin["event_id"] == "CLIN_CRL_RECEIVED"
    assert clin["evidence"]
    assert "CRL" in clin["evidence"] or "Complete Response" in clin["evidence"]


def test_dosing_milestone_first_and_last_patient():
    load_taxonomy.cache_clear()
    first = score_article_dimensions(
        "Cocrystal announced that the first patient has been dosed in its Phase 1b norovirus study.",
        use_ai=False,
    )
    # base 0.2 × Ph1 0.5 = 0.1
    assert first["clinical_score"] == 0.1
    assert first["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_DOSING_MILESTONE"

    last = score_article_dimensions(
        "The company announced that the last subject has been dosed in its Phase 1b challenge study.",
        use_ai=False,
    )
    assert last["clinical_score"] == 0.1
    assert last["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_DOSING_MILESTONE"


def test_study_completed_scales_by_phase():
    load_taxonomy.cache_clear()
    ph2 = score_article_dimensions(
        "The company announced it has completed the Phase 2 clinical study of DrugX.",
        use_ai=False,
    )
    # base 2.0 × Ph2 0.75 = 1.5
    assert ph2["clinical_score"] == 1.5
    assert ph2["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_STUDY_COMPLETED"

    ph3 = score_article_dimensions(
        "The company announced it has completed the Phase 3 clinical study of DrugX.",
        use_ai=False,
    )
    assert ph3["clinical_score"] == 2.0
    assert ph3["clinical_score"] > ph2["clinical_score"]


def test_study_success_above_completion_failure_negative():
    load_taxonomy.cache_clear()
    success = score_article_dimensions(
        "The company successfully completed the Phase 3 clinical study with positive results.",
        use_ai=False,
    )
    assert success["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_STUDY_SUCCESS"
    assert success["clinical_score"] == 2.4  # 2.4 × Ph3 1.0

    failed = score_article_dimensions(
        "The Phase 2 study failed to achieve its objectives.",
        use_ai=False,
    )
    assert failed["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_STUDY_FAILED"
    assert failed["clinical_score"] == -1.5  # -2.0 × 0.75


def test_press_extends_survival_phase3_scores_clinical():
    """Wire headlines often say 'extends survival' without 'primary endpoint'."""
    load_taxonomy.cache_clear()
    title = (
        "BioNTech (NASDAQ: BNTX) lung cancer drug extends survival vs chemo in Phase 3"
    )
    scored = score_article_dimensions(title, use_ai=False)
    assert scored["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_STUDY_SUCCESS"
    assert scored["clinical_score"] and scored["clinical_score"] > 0
    assert scored["eis_score"] is not None and scored["eis_score"] > 0
    assert scored["heuristic_rev"] >= 4


def test_earnings_results_score_financial_not_clinical_approval():
    load_taxonomy.cache_clear()
    text = (
        "SeaStar Medical reports second quarter 2026 results. "
        "Net revenue of $0.6 million, an 82% increase. Gross margin of 91%. "
        "Net loss of $3.7 million ($0.91 per share). Cash position of $7.0 million. "
        "Commercial adoption of QUELIMMUNE within pediatric hospitals and the "
        "SAVE post-approval registry continue."
    )
    scored = score_article_dimensions(text, use_ai=False)
    fin = scored["taxonomy_dimensions"]["financial"]
    clin = scored["taxonomy_dimensions"]["clinical"]
    assert fin["event_id"] == "FIN_EARNINGS_REPORTED"
    assert clin["unclassified"] is True
    assert clin.get("event_id") in (None, "")


def test_earnings_with_incidental_primary_met_stays_financial():
    """AI brief / registry fluff must not turn a P&L release into CLIN +3."""
    load_taxonomy.cache_clear()
    text = (
        "ICU reports second quarter 2026 financial results\n"
        "Net revenue of $0.6 million. Gross margin of approximately 91%. "
        "Operating expenses: R&D $2.5M, G&A $1.8M. Net loss of $3.7 million. "
        "Cash position of $7.0 million. SAVE post-approval registry continues. "
        "Phase 3 topline primary endpoint MET (registrational) mentioned in outlook."
    )
    scored = score_article_dimensions(text, use_ai=False)
    fin = scored["taxonomy_dimensions"]["financial"]
    clin = scored["taxonomy_dimensions"]["clinical"]
    assert fin["event_id"] == "FIN_EARNINGS_REPORTED"
    assert clin.get("event_id") in (None, "")
    assert clin.get("unclassified") is True
    assert (scored.get("clinical_score") or 0) == 0
    assert scored.get("financial_score") is not None


def test_real_fda_approval_still_clinical():
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "Company received FDA approval for DrugX for the treatment of rare disease.",
        use_ai=False,
    )
    assert scored["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_APPROVAL_GRANTED"


def test_china_nmpa_approval_is_clinical_positive():
    """Ex-US / China NMPA approvals must not fall through to a negative fuzzy Clin."""
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment\n"
        "China's NMPA approved the subcutaneous LEQEMBI formulation for early AD.",
        use_ai=False,
    )
    clin = scored["taxonomy_dimensions"]["clinical"]
    assert clin["event_id"] == "CLIN_APPROVAL_GRANTED"
    assert (scored.get("clinical_score") or 0) > 0


def test_unclassified_press_has_null_eis_not_fake_zero():
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "BNTX Looks 25.5% Overvalued on GF Value Amid Mixed Signals",
        use_ai=False,
    )
    assert scored["taxonomy_dimensions"]["clinical"]["unclassified"] is True
    assert scored["eis_score"] is None


def test_8k_fill_dosing_when_clinical_empty():
    from eis_taxonomy_scoring import (
        _fill_empty_dims_from_heuristic,
        classify_8k_filing_result,
    )

    load_taxonomy.cache_clear()
    obj = {
        "items_detected": ["7.01", "9.01"],
        "classifications": {
            "clinical": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "financial": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "corporate": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": "Item 7.01: last subject has been dosed in Phase 1b.",
    }
    classified = classify_8k_filing_result(obj)
    classified = _fill_empty_dims_from_heuristic(
        classified,
        "Item 7.01 Regulation FD. The last subject has been dosed in the Phase 1b norovirus challenge study.",
    )
    clin = classified["dimensions"]["clinical"]
    assert clin["event_id"] == "CLIN_DOSING_MILESTONE"
    assert clin["score"] == 0.1


def test_atm_sales_agreement_not_shelf_zero():
    """CHRS-style: model tags FIN_SHELF_FILED but body is ATM — reclassify dilutive."""
    from eis_taxonomy_scoring import (
        _prefer_atm_over_shelf,
        classify_8k_filing_result,
        classification_to_score_fields,
    )

    load_taxonomy.cache_clear()
    obj = {
        "items_detected": ["8.01"],
        "classifications": {
            "clinical": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "financial": {
                "event_id": "FIN_SHELF_FILED",
                "evidence_quote": "shelf registration",
                "magnitude": {},
            },
            "corporate": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": "ATM equity sales agreement for up to $50 million.",
    }
    classified = classify_8k_filing_result(obj)
    text = (
        "Item 8.01. Coherus entered into an at-the-market sales agreement "
        "for the offer and sale of up to $50 million of common stock."
    )
    classified = _prefer_atm_over_shelf(classified, text)
    fin = classified["dimensions"]["financial"]
    assert fin["event_id"] == "FIN_DILUTIVE_OFFERING"
    assert fin["classification_method"] == "atm_shelf_correct"
    scored = classification_to_score_fields(classified)
    assert (scored.get("financial_score") or 0) < 0


def test_board_hire_suppresses_incidental_approval():
    """COCP-style: CLIN_APPROVAL_GRANTED on a director appointment → clear clinical."""
    from eis_taxonomy_scoring import (
        _suppress_incidental_clinical_on_board_hire,
        classify_8k_filing_result,
        classification_to_score_fields,
    )

    load_taxonomy.cache_clear()
    obj = {
        "items_detected": ["7.01", "5.02"],
        "classifications": {
            "clinical": {
                "event_id": "CLIN_APPROVAL_GRANTED",
                "evidence_quote": "plans to seek BLA approval",
                "magnitude": {},
            },
            "financial": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "corporate": {
                "event_id": "CORP_EXEC_HIRE",
                "evidence_quote": "appointed to the board",
                "magnitude": {},
            },
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": "Director appointed; company plans BLA.",
    }
    classified = classify_8k_filing_result(obj)
    text = (
        "Item 5.02. The Board appointed Jane Doe as an independent director. "
        "Item 7.01. Management discussed future plans to seek BLA approval for its lead asset."
    )
    classified = _suppress_incidental_clinical_on_board_hire(classified, text)
    clin = classified["dimensions"]["clinical"]
    assert clin.get("event_id") in (None, "")
    assert clin.get("classification_method") == "board_hire_clinical_suppress"
    scored = classification_to_score_fields(classified)
    assert abs(float(scored.get("clinical_score") or 0)) < 0.15


def test_real_fda_approval_on_board_hire_kept():
    """Do not suppress when the same filing has real FDA approval language."""
    from eis_taxonomy_scoring import (
        _suppress_incidental_clinical_on_board_hire,
        classify_8k_filing_result,
    )

    load_taxonomy.cache_clear()
    obj = {
        "items_detected": ["5.02", "8.01"],
        "classifications": {
            "clinical": {
                "event_id": "CLIN_APPROVAL_GRANTED",
                "evidence_quote": "FDA approval",
                "magnitude": {},
            },
            "financial": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "corporate": {
                "event_id": "CORP_EXEC_HIRE",
                "evidence_quote": "appointed CFO",
                "magnitude": {},
            },
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": "FDA approval + CFO hire.",
    }
    classified = classify_8k_filing_result(obj)
    text = (
        "The company received FDA approval for DrugX. "
        "Separately, Jane Doe was appointed as Chief Financial Officer."
    )
    classified = _suppress_incidental_clinical_on_board_hire(classified, text)
    assert classified["dimensions"]["clinical"]["event_id"] == "CLIN_APPROVAL_GRANTED"


def test_litigation_overhang_scores_corporate_negative():
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "Regeneron stock slips as Fianlimab-Libtayo lawsuits add legal overhang",
        use_ai=False,
    )
    assert scored["corporate_score"] < 0
    assert (
        scored["taxonomy_dimensions"]["corporate"]["event_id"]
        == "CORP_LITIGATION_FILED"
    )


def test_reconcile_moves_clin_approval_off_corporate():
    from eis_taxonomy_scoring import (
        _empty_dim_result,
        _reconcile_misplaced_event_dimensions,
        compute_dimension_score,
    )

    load_taxonomy.cache_clear()
    scored = compute_dimension_score("CLIN_APPROVAL_GRANTED", [])
    by_dim = {
        "clinical": _empty_dim_result("clinical"),
        "financial": _empty_dim_result("financial"),
        "corporate": {
            **scored,
            "dimension": "corporate",
            "evidence": "Japan's regulatory approval of the Leqembi Pen",
            "classification_method": "ai",
            "unclassified": False,
        },
        "market_access": _empty_dim_result("market_access"),
    }
    out = _reconcile_misplaced_event_dimensions(by_dim)
    assert out["corporate"].get("event_id") in (None, "")
    assert out["clinical"]["event_id"] == "CLIN_APPROVAL_GRANTED"
    assert "dim_reconcile" in str(out["clinical"].get("classification_method") or "")


def test_stock_tape_suppresses_incidental_japan_approval():
    """BIIB AD HOC: 1.6% slide wrap must not light Clin via buried Leqembi approval."""
    from eis_taxonomy_scoring import (
        _empty_dim_result,
        _postprocess_dimension_hits,
        compute_dimension_score,
    )

    load_taxonomy.cache_clear()
    scored = compute_dimension_score("CLIN_APPROVAL_GRANTED", [])
    by_dim = {
        "clinical": _empty_dim_result("clinical"),
        "financial": _empty_dim_result("financial"),
        "corporate": {
            **scored,
            "dimension": "corporate",
            "evidence": "Japan's regulatory approval of the Leqembi Pen",
            "classification_method": "ai",
            "unclassified": False,
            "thermometer_importance": 0.2,
        },
        "market_access": _empty_dim_result("market_access"),
    }
    text = (
        "Biogen stock heads into the open after a 1.6 percent slide - AD HOC NEWS\n"
        "Market Valuation and Index Comparison. Biogen market cap $31.84 billion.\n"
        "Profit-taking near 52-week highs occurred as investors digested fresh company "
        "guidance and the regulatory approval of the Leqembi Pen in Japan.\n"
        "Close USD 215.50 on Nasdaq, down 1.62 percent."
    )
    out = _postprocess_dimension_hits(by_dim, text)
    assert out["corporate"].get("event_id") in (None, "")
    assert out["clinical"].get("event_id") in (None, "")
    assert out["clinical"].get("classification_method") == "stock_tape_clinical_suppress"


def test_stock_tape_keeps_true_approval_headline():
    from eis_taxonomy_scoring import (
        _empty_dim_result,
        _postprocess_dimension_hits,
        compute_dimension_score,
    )

    load_taxonomy.cache_clear()
    scored = compute_dimension_score("CLIN_APPROVAL_GRANTED", [])
    by_dim = {
        "clinical": {
            **scored,
            "dimension": "clinical",
            "evidence": "FDA approval for DrugX",
            "classification_method": "ai",
            "unclassified": False,
        },
        "financial": _empty_dim_result("financial"),
        "corporate": _empty_dim_result("corporate"),
        "market_access": _empty_dim_result("market_access"),
    }
    text = (
        "Company receives FDA approval for DrugX in Alzheimer's disease\n"
        "Shares rose 4 percent in pre-market trading after the decision."
    )
    out = _postprocess_dimension_hits(by_dim, text)
    assert out["clinical"]["event_id"] == "CLIN_APPROVAL_GRANTED"


def test_detect_news_kind_stock_tape_is_financial():
    from daily_news_desk import _detect_news_kind

    kind = _detect_news_kind(
        "Close USD 215.50; investors digested the regulatory approval of the Leqembi Pen in Japan.",
        title="Biogen stock heads into the open after a 1.6 percent slide - AD HOC NEWS",
    )
    assert kind == "financial"
