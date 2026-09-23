"""Tests for catalyst extractor safeguards."""

from catalyst_extractor import _fetch_8k_bundle_text, _match_filings


def test_match_filings_skips_malformed_dates():
    filings = [
        {"filing_date": "2026-05-28", "accession": "ok"},
        {"filing_date": "not-a-date", "accession": "bad"},
    ]
    out = _match_filings(filings, target_date="2026-05-28", max_n=3)
    assert any(f.get("accession") == "ok" for f in out)
    assert all(f.get("accession") != "bad" for f in out)


def test_recent_filings_include_6k_when_requested():
    from catalyst_extractor import _recent_8k_filings

    subs = {
        "filings": {
            "recent": {
                "form": ["6-K", "8-K", "10-Q"],
                "filingDate": ["2026-09-16", "2026-09-01", "2026-08-01"],
                "accessionNumber": ["a", "b", "c"],
                "primaryDocument": ["6k.htm", "8k.htm", "10q.htm"],
                "items": ["", "2.02", ""],
                "primaryDocDescription": ["", "", ""],
            }
        }
    }
    only8 = _recent_8k_filings(subs, max_n=10, include_6k=False)
    assert [x["form_type"] for x in only8] == ["8-K"]
    both = _recent_8k_filings(subs, max_n=10, include_6k=True)
    assert [x["form_type"] for x in both] == ["6-K", "8-K"]


def test_recent_filings_include_424b_and_def14a():
    from catalyst_extractor import _recent_8k_filings

    subs = {
        "filings": {
            "recent": {
                "form": ["424B5", "DEF 14A", "8-K", "10-K"],
                "filingDate": ["2026-09-10", "2026-09-01", "2026-08-20", "2026-03-01"],
                "accessionNumber": ["a", "b", "c", "d"],
                "primaryDocument": ["424b5.htm", "def14a.htm", "8k.htm", "10k.htm"],
                "items": ["", "", "1.01", ""],
                "primaryDocDescription": ["", "", "", ""],
            }
        }
    }
    out = _recent_8k_filings(
        subs,
        max_n=10,
        include_6k=True,
        extra_forms={"424B2", "424B3", "424B4", "424B5", "DEF 14A"},
    )
    assert [x["form_type"] for x in out] == ["424B5", "DEF 14A", "8-K"]


def test_force_exhibits_bypasses_keyword_skip(monkeypatch):
    """Wrapper Items must fetch Ex-99 even when primary mentions topline/Qx."""
    primary = (
        "Item 7.01 Regulation FD Disclosure. The company issued a press release "
        "announcing Phase 2b topline results for Q3 2026. See Exhibit 99.1. "
        + ("boilerplate " * 2000)
    )
    exhibit = (
        "FOR IMMEDIATE RELEASE. Phase 2b met the primary endpoint with 62% response "
        "rate (p<0.01) versus placebo at week 24. NCT01234567. "
        "Full efficacy and safety tables are presented below for investor review. "
        + ("Additional clinical detail. " * 40)
    )

    def fake_fetch(_cik, _acc, doc, max_chars=120_000):
        if "ex99" in doc.lower() or "ex-99" in doc.lower():
            return exhibit[:max_chars]
        return primary[:max_chars]

    monkeypatch.setattr("catalyst_extractor._fetch_filing_text", fake_fetch)
    monkeypatch.setattr(
        "catalyst_extractor._filing_index_docs",
        lambda *_a, **_k: [
            {"name": "form8-k.htm", "size": 50_000},
            {"name": "ex99-1.htm", "size": 40_000},
        ],
    )

    meta: dict = {}
    # Without force: keyword skip (primary has topline + length)
    skipped = _fetch_8k_bundle_text(
        "0000123456",
        "0000123456-26-000001",
        "form8-k.htm",
        max_chars=80_000,
        fetch_exhibits=True,
        force_exhibits=False,
        meta_out=meta,
    )
    assert meta.get("exhibit_fetch_mode") == "keyword_skip"
    assert "62%" not in (skipped or "")

    meta2: dict = {}
    forced = _fetch_8k_bundle_text(
        "0000123456",
        "0000123456-26-000001",
        "form8-k.htm",
        max_chars=80_000,
        fetch_exhibits=True,
        force_exhibits=True,
        meta_out=meta2,
    )
    assert meta2.get("exhibit_fetch_mode") == "forced"
    assert meta2.get("exhibit_names") == ["ex99-1.htm"]
    assert meta2.get("bundle_chars_exhibit", 0) > 0
    assert "62%" in (forced or "")
    assert "NCT01234567" in (forced or "")


def test_bundle_prefers_trimming_primary_over_exhibit(monkeypatch):
    primary = "PRIMARY_BODY " + ("x" * 60_000)
    exhibit = "EXHIBIT_NUMBERS revenue $50 million and EPS $1.20 " + ("y" * 40_000)

    def fake_fetch(_cik, _acc, doc, max_chars=120_000):
        if "ex99" in doc.lower():
            return exhibit[:max_chars]
        return primary[:max_chars]

    monkeypatch.setattr("catalyst_extractor._fetch_filing_text", fake_fetch)
    monkeypatch.setattr(
        "catalyst_extractor._filing_index_docs",
        lambda *_a, **_k: [
            {"name": "form8-k.htm", "size": 70_000},
            {"name": "ex99-1.htm", "size": 50_000},
        ],
    )
    meta: dict = {}
    out = _fetch_8k_bundle_text(
        "0000123456",
        "0000123456-26-000001",
        "form8-k.htm",
        max_chars=80_000,
        fetch_exhibits=True,
        force_exhibits=True,
        meta_out=meta,
    )
    assert out
    assert len(out) <= 80_000
    assert "EXHIBIT_NUMBERS" in out
    assert "$50 million" in out
    # Primary may be trimmed; exhibit substance kept
    assert meta["bundle_chars_exhibit"] > 0
