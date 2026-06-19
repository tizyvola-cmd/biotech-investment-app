"""Tests for catalyst extractor safeguards."""

from catalyst_extractor import _match_filings


def test_match_filings_skips_malformed_dates():
    filings = [
        {"filing_date": "2026-05-28", "accession": "ok"},
        {"filing_date": "not-a-date", "accession": "bad"},
    ]
    out = _match_filings(filings, target_date="2026-05-28", max_n=3)
    assert any(f.get("accession") == "ok" for f in out)
    assert all(f.get("accession") != "bad" for f in out)

