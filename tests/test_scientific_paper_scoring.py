"""Scientific papers → clinical score + company-affiliation boost."""

from eis_taxonomy_scoring import (
    CLIN_SCIENTIFIC_PUBLICATION_ID,
    COMPANY_AFFILIATION_MODIFIER_ID,
    apply_company_affiliation_boost,
    ensure_paper_clinical_baseline,
    load_taxonomy,
    score_scientific_paper,
)


def test_taxonomy_has_publication_and_affiliation_modifier():
    tax = load_taxonomy()
    ids = {e["id"] for e in tax["events"]}
    assert CLIN_SCIENTIFIC_PUBLICATION_ID in ids
    mods = {m["id"]: m for m in tax["modifiers"]}
    assert COMPANY_AFFILIATION_MODIFIER_ID in mods
    assert float(mods[COMPANY_AFFILIATION_MODIFIER_ID]["multiplier"]) == 1.5


def test_paper_baseline_when_no_endpoint_hit():
    text = (
        "The National Health Service–Galleri multicancer screening trial: "
        "explanation and justification of unique and important design issues. "
        "This peer-reviewed article discusses RCT design for GRAIL's Galleri "
        "liquid biopsy multicancer early detection test in the NHS."
    )
    scored = score_scientific_paper(text, company_affiliated=False)
    assert scored.get("is_paper") is True
    clin = float(scored.get("clinical_score") or 0)
    assert clin > 0
    dims = scored.get("taxonomy_dimensions") or {}
    assert (dims.get("clinical") or {}).get("event_id") == CLIN_SCIENTIFIC_PUBLICATION_ID


def test_affiliation_boost_increases_clinical():
    text = (
        "Phase 3 results of drug X in solid tumors published in a peer-reviewed "
        "journal. The randomized controlled trial enrolled 400 patients."
    )
    base = score_scientific_paper(text, company_affiliated=False)
    boosted = score_scientific_paper(text, company_affiliated=True)
    assert float(boosted["clinical_score"]) > float(base["clinical_score"])
    mods = (boosted.get("taxonomy_dimensions") or {}).get("clinical", {}).get(
        "modifiers_applied"
    ) or []
    assert any(m.get("id") == COMPANY_AFFILIATION_MODIFIER_ID for m in mods)


def test_boost_idempotent():
    text = "Peer-reviewed publication on product Y clinical outcomes in oncology."
    once = score_scientific_paper(text, company_affiliated=True)
    twice = apply_company_affiliation_boost(
        ensure_paper_clinical_baseline(dict(once), text=text),
        company_affiliated=True,
    )
    assert float(twice["clinical_score"]) == float(once["clinical_score"])
