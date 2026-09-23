"""Reference verification for AI feed clinical events."""
from clinical_pre_cd_enrichment import annotate_events_reference_verification, verify_event_reference
from data_orchestrator import _compute_sponsor_match
from prediction.eis_feed_quality import (
    event_has_usable_reference_text,
    filter_verified_feed_events,
    is_study_sponsor_trusted,
    is_valid_feed_ticker,
    recompute_record_sponsor_match,
)


def test_sec_8k_always_verified():
    ok, m = verify_event_reference(
        {"source_type": "sec_8k", "event_title": "Officer departure"},
        company="CNS Pharmaceuticals, Inc.",
        ticker="CNSP",
        drug_tokens=["Berubicin"],
    )
    assert ok and m == "sec_8k"


def test_drug_in_publication_title():
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Characteristics of adverse reactions of Berubicin in WHO-VigiAccess",
            "summary": "Study on anti-glioma drugs.",
        },
        company="CNS Pharmaceuticals, Inc.",
        ticker="CNSP",
        drug_tokens=["Berubicin", "TPI-287"],
    )
    assert ok and m in ("drug", "company+drug")


def test_unrelated_publication_rejected():
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Global trends in oncology trial design",
            "summary": "Meta-analysis across pharma industry.",
        },
        company="CNS Pharmaceuticals, Inc.",
        ticker="CNSP",
        drug_tokens=["Berubicin"],
    )
    assert not ok and m is None


def test_vera_contamination_pembrolizumab_rejected():
    """VERA: unrelated oncology pub must not pass on ticker substring «vera» alone."""
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Pembrolizumab Plus Chemotherapy in Squamous NSCLC: KEYNOTE-407",
            "summary": "Phase III endpoints and survival.",
            "drug": "—",
        },
        company="Vera Therapeutics, Inc.",
        ticker="VERA",
        drug_tokens=["atacicept", "MAU868"],
    )
    assert not ok and m is None


def test_shared_soc_pembrolizumab_alone_rejected():
    """Combo-trial SOC (Keytruda) must not attach Enfortumab/bladder papers."""
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Perioperative Enfortumab Vedotin and Pembrolizumab in Bladder Cancer.",
            "summary": "Phase 3 open-label trial in muscle-invasive bladder cancer.",
        },
        company="Eton Pharmaceuticals, Inc.",
        ticker="ETON",
        drug_tokens=["pembrolizumab", "rezatapopt"],
        expected_nct_id="NCT04585750",
    )
    assert not ok and m is None


def test_study_specific_drug_still_accepted():
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Rezatapopt (PC14586) in TP53 Y220C solid tumors — PYNNACLE",
            "summary": "Phase 1/2 efficacy and safety of rezatapopt monotherapy.",
        },
        company="PMV Pharmaceuticals, Inc.",
        ticker="PMVP",
        drug_tokens=["pembrolizumab", "rezatapopt"],
    )
    assert ok and m in ("drug", "company+drug", "company")


def test_vera_company_phrase_and_drug_accepted():
    ok, m = verify_event_reference(
        {
            "source_type": "publication",
            "event_title": "Vera Therapeutics reports atacicept Phase 3 IgAN data",
            "summary": "Primary endpoint met.",
            "drug": "atacicept",
        },
        company="Vera Therapeutics, Inc.",
        ticker="VERA",
        drug_tokens=["atacicept"],
    )
    assert ok and m in ("company+drug", "company", "drug")


def test_filter_verified_feed_events():
    events = filter_verified_feed_events(
        [
            {"source_type": "publication", "reference_verified": False, "event_title": "noise title here"},
            {"source_type": "publication", "reference_verified": True, "event_title": "ok publication title"},
            {"source_type": "sec_8k", "event_title": "filing"},
            {"source_type": "publication", "reference_verified": True, "event_title": ""},
        ]
    )
    assert len(events) == 2
    assert events[0]["event_title"].startswith("ok")
    assert events[1]["source_type"] == "sec_8k"


def test_empty_title_publication_rejected():
    ok, m = verify_event_reference(
        {"source_type": "publication", "event_title": "", "summary": ""},
        company="Acme Bio",
        ticker="ACME",
        drug_tokens=["drugx"],
    )
    assert not ok and m is None


def test_ctgov_requires_matching_nct():
    ok, m = verify_event_reference(
        {
            "source_type": "ctgov",
            "event_title": "Study update on NCT00000001",
            "link": "https://clinicaltrials.gov/study/NCT00000001",
        },
        company="Acme Bio",
        ticker="ACME",
        drug_tokens=[],
        expected_nct_id="NCT99999999",
    )
    assert not ok and m is None


def test_invalid_ticker_rejected():
    assert not is_valid_feed_ticker("NAN")
    assert not is_valid_feed_ticker("")
    assert is_valid_feed_ticker("VERA")


def test_event_has_usable_reference_text():
    assert not event_has_usable_reference_text({"source_type": "publication", "event_title": "short"})
    assert event_has_usable_reference_text(
        {"source_type": "publication", "event_title": "Long enough publication title"}
    )


def test_annotate_sets_fields():
    events = annotate_events_reference_verification(
        [
            {
                "source_type": "publication",
                "event_title": "Berubicin DNA interaction study",
                "summary": "",
            }
        ],
        company="CNS Pharmaceuticals, Inc.",
        ticker="CNSP",
        drug_tokens=["Berubicin"],
    )
    assert events[0]["reference_verified"] is True
    assert events[0]["reference_match"] == "drug"


def test_eton_pmv_not_sponsor_match():
    """Shared «Pharmaceuticals Inc» must not yield Exact/Partial."""
    assert _compute_sponsor_match(
        "Eton Pharmaceuticals, Inc.",
        "PMV Pharmaceuticals, Inc",
    ) == "No match"
    rec = {
        "ticker": "ETON",
        "company": "Eton Pharmaceuticals, Inc.",
        "sponsor_match": "Exact",  # stale
        "meta": {"lead_sponsor": "PMV Pharmaceuticals, Inc"},
    }
    assert recompute_record_sponsor_match(rec) == "No match"
    assert is_study_sponsor_trusted(rec) is False


def test_c4_therapeutics_exact_sponsor_trusted():
    """C4 Therapeutics: Exact match but no len≥3 distinctive token besides generics."""
    rec = {
        "ticker": "CCCC",
        "company": "C4 Therapeutics, Inc.",
        "meta": {"lead_sponsor": "C4 Therapeutics, Inc."},
    }
    assert recompute_record_sponsor_match(rec) == "Exact"
    assert is_study_sponsor_trusted(rec) is True
