"""CHMP / EU recommend-for-approval and IDFS risk-cut heuristics."""
from __future__ import annotations

from eis_taxonomy_scoring import load_taxonomy, score_article_dimensions


def test_chmp_positive_opinion_scores_clinical_approval():
    load_taxonomy.cache_clear()
    text = (
        "Enhertu Recommended for Approval in the EU by CHMP as Adjuvant Treatment "
        "for Patients with Residual Disease. CHMP positive opinion based on "
        "DESTINY-Breast05. Enhertu reduced the risk of invasive disease "
        "recurrence or death by 53% (hazard ratio [HR]=0.47; p<0.0001) versus T-DM1."
    )
    scored = score_article_dimensions(text, use_ai=False)
    clin = scored["taxonomy_dimensions"]["clinical"]
    assert clin["event_id"] in {
        "CLIN_APPROVAL_GRANTED",
        "CLIN_PRIMARY_MET",
        "CLIN_STUDY_SUCCESS",
        "CLIN_TOPLINE_POSITIVE",
    }
    assert float(scored["clinical_score"] or 0) > 0


def test_eu_committee_headline_scores_without_body():
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
        "EU committee recommends it.",
        use_ai=False,
    )
    assert float(scored["clinical_score"] or 0) > 0
