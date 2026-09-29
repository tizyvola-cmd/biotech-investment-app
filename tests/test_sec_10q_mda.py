"""Unit tests for 10-Q MD&A / Recent Developments isolation."""

from __future__ import annotations

from sec_10q_mda import extract_10q_pipeline_section, headline_from_10q_section
from sec_10q_extractor import _form_is_10q, recent_10q_filings


def test_form_is_10q():
    assert _form_is_10q("10-Q")
    assert _form_is_10q("10-Q/A")
    assert not _form_is_10q("8-K")
    assert not _form_is_10q("10-K")


def test_extract_recent_developments_prefers_subsection():
    text = """
PART I
Item 1. Financial Statements
cash and cash equivalents were $10 million.

Item 2. Management's Discussion and Analysis of Financial Condition
Overview
We are a biotech company.

Recent Developments
In January 2026 we announced positive topline results from Study XYZ with ORR 42%.
We also initiated a Phase 3 trial in oncology.

Liquidity and Capital Resources
We had cash of $50 million.

Item 3. Quantitative and Qualitative Disclosures
Market risk discussion here.
"""
    out = extract_10q_pipeline_section(text)
    assert out["section"] == "recent_developments"
    assert "ORR 42%" in out["text"]
    assert "Liquidity and Capital" not in out["text"]
    assert "Market risk" not in out["text"]


def test_extract_falls_back_to_mda_not_full_doc():
    text = """
Item 1. Financial Statements
Huge balance sheet tables and notes go here forever.

Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations
We continue to advance our pipeline candidates ABC-123 and DEF-456 through clinical development.
Enrollment remains on track for the pivotal study.

Item 3. Quantitative and Qualitative Disclosures About Market Risk
Interest rate risk and FX risk discussion.
"""
    out = extract_10q_pipeline_section(text)
    assert out["section"] == "mda_item2"
    assert "ABC-123" in out["text"]
    assert "balance sheet tables" not in out["text"]
    assert "Interest rate risk" not in out["text"]


def test_extract_returns_none_rather_than_full_document():
    text = "Only financial tables and auditor opinions without MD&A headings. " * 40
    out = extract_10q_pipeline_section(text)
    assert out["section"] == "none"
    assert out["text"] == ""


def test_headline_from_section():
    h = headline_from_10q_section(
        "Recent Developments\n"
        "In March 2026 the company reported that the Phase 2 study met its primary endpoint."
    )
    assert "Phase 2" in h
    assert len(h) <= 140


def test_recent_10q_filings_filters_forms():
    submissions = {
        "filings": {
            "recent": {
                "form": ["8-K", "10-Q", "10-Q/A", "10-K"],
                "filingDate": ["2026-01-01", "2026-05-01", "2026-08-01", "2026-03-01"],
                "accessionNumber": ["a", "b", "c", "d"],
                "primaryDocument": ["x.htm", "y.htm", "z.htm", "k.htm"],
                "primaryDocDescription": ["", "", "", ""],
            }
        }
    }
    rows = recent_10q_filings(submissions, max_n=5, lookback_days=900)
    forms = [r["form_type"] for r in rows]
    assert forms == ["10-Q", "10-Q/A"]
    assert rows[0]["accession"] == "b"
