"""Medtech CT.gov sponsor discovery — target resolution (no network)."""
from medtech_universe import (
    resolve_sponsor_study_targets,
    sponsor_search_terms_for_ticker,
    SPONSOR_TICKER_ALIASES,
)


def test_explicit_xray_target_not_empty():
    target = resolve_sponsor_study_targets(["XRAY"])
    assert target == ["XRAY"]


def test_explicit_ticker_not_limited_to_alias_list():
    """Regression: tickers=[XRAY] must not return [] when XRAY not only in aliases."""
    assert "XRAY" in SPONSOR_TICKER_ALIASES.values()
    target = resolve_sponsor_study_targets(["XRAY", "ZBH"])
    assert "XRAY" in target
    assert "ZBH" in target


def test_sponsor_search_terms_use_company_not_ticker_symbol():
    t2c = {"XRAY": "Dentsply Sirona Inc."}
    terms = sponsor_search_terms_for_ticker("XRAY", t2c)
    assert "Dentsply Sirona Inc." in terms
    assert "dentsply sirona" in terms
    assert "XRAY" not in terms


def test_default_targets_include_alias_tickers():
    target = resolve_sponsor_study_targets(None)
    assert "CERS" in target
    assert "XRAY" in target
