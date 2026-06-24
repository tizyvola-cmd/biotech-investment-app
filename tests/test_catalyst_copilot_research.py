"""Tests for Catalyst Copilot live research entity resolution."""
from __future__ import annotations

from catalyst_copilot_research import resolve_company_name


def test_resolve_biontech_from_italian_message():
    tk, company = resolve_company_name(
        message="mi tiri fuori tutti gli ultimi studi pubblicati da biontech",
    )
    assert tk == "BNTX"
    assert company and "biontech" in company.lower()


def test_resolve_ticker_hint():
    tk, company = resolve_company_name(ticker="BNTX", message="latest trials")
    assert tk == "BNTX"
    assert company
