"""Tests for SEC forward catalyst calendar parsing."""

from __future__ import annotations

from catalyst_calendar_parse import (
    extract_events_from_text,
    extract_window_label,
    items_match,
    parse_items_field,
)


def test_parse_items_list_and_string():
    assert parse_items_field(["8.01", "9.01"]) == {"8.01", "9.01"}
    assert parse_items_field("2.02, 7.01") == {"2.02", "7.01"}
    assert items_match("8.01,9.01", {"8.01"})
    assert not items_match("2.02", {"8.01"})


def test_pdufa_exact_date_from_8k_801():
    text = (
        "On November 12, 2025 the FDA accepted the NDA. "
        "The PDUFA target action date of February 25, 2026 has been assigned."
    )
    rows = extract_events_from_text(
        text,
        ticker="ETON",
        source_form="8-K",
        source_items=["8.01", "9.01"],
        source_filing_url="https://example.test/8k",
        extracted_at="2025-11-12T00:00:00Z",
        accession="0001",
        filing_date="2025-11-12",
    )
    pdufa = [r for r in rows if r["event_type"] == "PDUFA"]
    assert pdufa
    assert pdufa[0]["date_precision"] == "exact_date"
    assert pdufa[0]["date_value"] == "2026-02-25"
    assert pdufa[0]["window_label"] is None
    assert pdufa[0]["confidence"] == "high"


def test_readout_window_never_gets_exact_date():
    text = (
        "Topline data readout is expected in 2H 2026 for the pivotal study. "
        "Primary endpoint analysis planned."
    )
    rows = extract_events_from_text(
        text,
        ticker="CHRS",
        source_form="8-K",
        source_items="2.02",
        source_filing_url="https://example.test/8k",
        extracted_at="2026-08-01T00:00:00Z",
        accession="0002",
    )
    rd = [r for r in rows if r["event_type"] == "Readout"]
    assert rd
    assert rd[0]["date_value"] is None
    assert rd[0]["window_label"] == "2H 2026"
    assert rd[0]["date_precision"] == "half_year_window"
    assert rd[0]["confidence"] == "medium"


def test_readout_from_10q_without_items():
    text = "Recent Developments. Top-line results expected in Q4 2026."
    rows = extract_events_from_text(
        text,
        ticker="ABC",
        source_form="10-Q",
        source_items=None,
        source_filing_url="https://example.test/10q",
        extracted_at="2026-05-01T00:00:00Z",
        accession="10q1",
    )
    rd = [r for r in rows if r["event_type"] == "Readout"]
    assert rd
    assert rd[0]["window_label"] == "Q4 2026"
    assert rd[0]["date_value"] is None


def test_pdufa_skipped_without_801_on_8k():
    text = "PDUFA target action date of March 1, 2027."
    rows = extract_events_from_text(
        text,
        ticker="X",
        source_form="8-K",
        source_items=["2.02"],
        source_filing_url="u",
        extracted_at="t",
        accession="a",
    )
    assert not [r for r in rows if r["event_type"] == "PDUFA"]


def test_nda_acceptance_is_pdufa_calendar():
    """Filing itself is the calendar — NDA accepted + target action date."""
    text = (
        "On November 12, 2025, the FDA accepted the Company's NDA for review. "
        "The Agency assigned a PDUFA target action date of February 25, 2026."
    )
    rows = extract_events_from_text(
        text,
        ticker="ETON",
        source_form="8-K",
        source_items=["8.01"],
        source_filing_url="u",
        extracted_at="t",
        accession="eton-nda",
        filing_date="2025-11-12",
    )
    pdufa = [r for r in rows if r["event_type"] == "PDUFA"]
    assert pdufa
    assert any(r["date_value"] == "2026-02-25" for r in pdufa)


def test_conference_requires_name_and_prefers_exact_date():
    text = (
        "The Company will present data at ASCO Annual Meeting on June 2, 2026 "
        "in an oral presentation."
    )
    rows = extract_events_from_text(
        text,
        ticker="XYZ",
        source_form="8-K",
        source_items=["7.01"],
        source_filing_url="u",
        extracted_at="t",
        accession="asco1",
    )
    conf = [r for r in rows if r["event_type"] == "Conference"]
    assert conf
    assert conf[0]["date_precision"] == "exact_date"
    assert conf[0]["date_value"] == "2026-06-02"
    assert conf[0]["confidence"] == "medium"


def test_conference_without_congress_name_dropped():
    text = "We will present at an upcoming industry meeting on May 1, 2026."
    rows = extract_events_from_text(
        text,
        ticker="XYZ",
        source_form="8-K",
        source_items=["7.01"],
        source_filing_url="u",
        extracted_at="t",
        accession="noname",
    )
    assert not [r for r in rows if r["event_type"] == "Conference"]



def test_readout_history_ids_differ_by_filing():
    text = "Topline expected in 2H 2026."
    a = extract_events_from_text(
        text,
        ticker="Z",
        source_form="8-K",
        source_items="7.01",
        source_filing_url="u1",
        extracted_at="2026-01-01T00:00:00Z",
        accession="acc-a",
    )
    b = extract_events_from_text(
        text,
        ticker="Z",
        source_form="8-K",
        source_items="7.01",
        source_filing_url="u2",
        extracted_at="2026-06-01T00:00:00Z",
        accession="acc-b",
    )
    assert a and b
    assert a[0]["id"] != b[0]["id"]


def test_partnership_window_from_8k_101():
    text = (
        "On September 3, 2026, the Company entered into an exclusive license agreement "
        "with Novartis Pharma AG. The Company received an upfront payment of $50 million "
        "and is eligible for up to $450 million in development and regulatory milestones. "
        "The parties expect to close the transaction in Q1 2027."
    )
    rows = extract_events_from_text(
        text,
        ticker="abcd",
        source_form="8-K",
        source_items=["1.01", "9.01"],
        source_filing_url="https://example.test/8k",
        extracted_at="2026-09-03T00:00:00Z",
        accession="acc-partner",
        filing_date="2026-09-03",
    )
    partner_rows = [r for r in rows if r["event_type"] == "Partnership"]
    assert len(partner_rows) == 1
    row = partner_rows[0]
    assert row["window_label"] == "Q1 2027"
    assert row["date_precision"] == "quarter_window"
    assert row["date_value"] is None
    assert row["source_item"] == "1.01"
    assert row["partner"] == "Novartis Pharma AG"


def test_partnership_exact_date_never_reuses_signature_date():
    text = (
        "On September 3, 2026, the Company entered into a collaboration agreement with "
        "Bayer Pharmaceuticals providing for milestone payments and tiered royalties. "
        "The option exercise period expires on December 31, 2027."
    )
    rows = extract_events_from_text(
        text,
        ticker="XYZ",
        source_form="8-K",
        source_items=["1.01"],
        source_filing_url="u",
        extracted_at="2026-09-03T00:00:00Z",
        accession="acc-opt",
        filing_date="2026-09-03",
    )
    partner_rows = [r for r in rows if r["event_type"] == "Partnership"]
    assert partner_rows
    assert partner_rows[0]["date_value"] == "2027-12-31"
    assert partner_rows[0]["date_precision"] == "exact_date"


def test_partnership_needs_forward_leg():
    text = (
        "On September 3, 2026, the Company entered into a license agreement with "
        "Pfizer Inc. and received an upfront payment of $10 million."
    )
    rows = extract_events_from_text(
        text,
        ticker="Q",
        source_form="8-K",
        source_items=["1.01"],
        source_filing_url="u",
        extracted_at="2026-09-03T00:00:00Z",
        accession="acc-signed",
        filing_date="2026-09-03",
    )
    assert not [r for r in rows if r["event_type"] == "Partnership"]


def test_partnership_skipped_without_deal_terms():
    text = (
        "The Company announced a research collaboration with Stanford University. "
        "The collaboration is expected to continue in 2H 2027."
    )
    rows = extract_events_from_text(
        text,
        ticker="Q",
        source_form="8-K",
        source_items=["8.01"],
        source_filing_url="u",
        extracted_at="2026-09-03T00:00:00Z",
        accession="acc-academic",
    )
    assert not [r for r in rows if r["event_type"] == "Partnership"]


def test_entry_is_current_exact_and_window():
    from datetime import date

    from catalyst_calendar_parse import entry_is_current

    today = date(2026, 9, 7)
    assert entry_is_current(
        {"event_type": "PDUFA", "date_value": "2027-04-14"}, today
    )
    assert not entry_is_current(
        {"event_type": "Conference", "date_value": "2025-12-06"}, today
    )
    assert not entry_is_current(
        {"event_type": "Readout", "window_label": "Q4 2025"}, today
    )
    assert entry_is_current(
        {"event_type": "Readout", "window_label": "2H 2026"}, today
    )
    assert not entry_is_current(
        {"event_type": "Conference", "date_precision": "quarter_window"}, today
    )
