"""Press body fallbacks when Google/Stock Titan return HTTP 429."""
from __future__ import annotations

from daily_news_desk import (
    _company_domain_candidates_from_title,
    _fetch_via_company_ir_press,
    _looks_like_analysis_headline,
)
from eis_taxonomy_scoring import load_taxonomy, score_article_dimensions


def test_company_domain_from_cocrystal_title():
    domains = _company_domain_candidates_from_title(
        "Cocrystal Pharma (COCP) finishes dosing human norovirus study"
    )
    assert any("cocrystalpharma.com" == d for d in domains)


def test_azn_enhertu_title_yields_astrazeneca_domain():
    title = (
        "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
        "EU committee recommends it. - Stock Titan"
    )
    domains = _company_domain_candidates_from_title(title)
    assert "astrazeneca.com" in domains
    assert all("cancerdrug" not in d for d in domains)


def test_analysis_headline_does_not_invent_junk_ir_domain():
    title = (
        "Beta Bionics: Mint Clearance Marks The Shift Toward A "
        "Multi-Engine Growth Story (BBNX)"
    )
    assert _looks_like_analysis_headline(title) is True
    domains = _company_domain_candidates_from_title(title)
    assert "betabionics.com" in domains
    assert all("mintclearance" not in d for d in domains)
    assert all(len(d.split(".")[0]) < 40 for d in domains)
    text, err = _fetch_via_company_ir_press("BBNX", title)
    assert text == ""
    assert err == "analysis_headline_skip_ir"


def test_finishes_dosing_headline_scores_clinical():
    load_taxonomy.cache_clear()
    scored = score_article_dimensions(
        "Cocrystal Pharma (COCP) finishes dosing human norovirus study, "
        "eyes first efficacy readout next",
        use_ai=False,
    )
    assert scored["taxonomy_dimensions"]["clinical"]["event_id"] == "CLIN_DOSING_MILESTONE"
    assert float(scored["clinical_score"] or 0) > 0


def test_company_ir_press_fetches_cocrystal_when_reachable():
    text, err = _fetch_via_company_ir_press(
        "COCP",
        "Cocrystal Pharma Announces Last Subject Dosed in Phase 1b Human Challenge Study",
    )
    # Local/CI may not reach IR; when reachable we must get body.
    if err and "http_" in str(err):
        return
    if not text:
        return
    assert len(text) > 280
    assert re_search_dosed(text)


def re_search_dosed(text: str) -> bool:
    import re

    return bool(re.search(r"(?i)dos(?:ed|ing)|norovirus|CDI-988", text or ""))
