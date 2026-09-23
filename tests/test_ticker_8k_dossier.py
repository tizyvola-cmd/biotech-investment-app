"""Ticker 8-K dossier helpers."""
from datetime import datetime
from zoneinfo import ZoneInfo

from ticker_8k_dossier import (
    _DIGEST_VERSION,
    _SUMMARY_MAX_WORDS,
    _cap_words,
    last_wednesday_cutoff,
    next_wednesday_iso,
)


_ROME = ZoneInfo("Europe/Rome")


def test_cap_words_default_budget():
    assert _SUMMARY_MAX_WORDS == 65
    assert _cap_words("one two three", 5) == "one two three"
    long = " ".join(f"w{i}" for i in range(80))
    out = _cap_words(long)
    assert out is not None
    assert len(out.split()) == 65
    assert out.endswith("…")


def test_numeric_excerpt_skips_signature_legalese():
    from ticker_8k_dossier import _numeric_excerpt

    blob = (
        "Pursuant to the requirements of the Securities Exchange Act of 1934, "
        "the registrant has duly authorized this report. "
        "Total revenue was $2.4 billion in the second quarter and diluted EPS was $4.01. "
        "Operating expenses declined versus the prior year."
    )
    out = _numeric_excerpt(blob, 50)
    assert out
    assert "2.4" in out
    assert "pursuant" not in out.lower()


def test_digest_filing_item_sessions(monkeypatch):
    from ticker_8k_dossier import _digest_filing

    monkeypatch.setattr("ticker_8k_dossier._call_8k_summarizer", lambda *a, **k: None)

    text = """
UNITED STATES SECURITIES AND EXCHANGE COMMISSION
Exact name of registrant: Biogen Inc.
Date of earliest event reported: July 29, 2026

Item 2.02 Results of Operations and Financial Condition.
On July 29, 2026, Biogen Inc. reported second quarter product revenue of $2.4 billion
and GAAP diluted EPS of $4.01, citing continued growth of Vumerity and a higher cash
balance versus the prior year. Management also noted operating expenses declined year
over year after the completion of a restructuring program.

Item 7.01 Regulation FD Disclosure.
The company furnished an earnings press release and investor slides as Exhibit 99.1
and Exhibit 99.2. The information in this Item 7.01 is being furnished and shall not
be deemed filed for purposes of Section 18 of the Exchange Act.

Item 9.01 Financial Statements and Exhibits.
Exhibit 99.1 Press release. Exhibit 99.2 Investor presentation.
"""
    card = _digest_filing(
        ticker="BIIB",
        text=text,
        filing_date="2026-07-29",
        url="https://www.sec.gov/Archives/example.htm",
        bundle_meta={
            "bundle_chars_primary": 4200,
            "bundle_chars_exhibit": 18000,
            "exhibit_names": ["ex99-1.htm"],
            "exhibit_fetch_mode": "forced",
        },
    )
    codes = [s["item"] for s in card["sessions"]]
    assert "2.02" in codes
    assert "7.01" in codes
    s202 = next(s for s in card["sessions"] if s["item"] == "2.02")
    assert s202["summary"]
    assert len(s202["summary"].split()) <= _SUMMARY_MAX_WORDS
    assert "2.4" in (s202["summary"] or "") or "revenue" in (s202["summary"] or "").lower()
    # Lot 1 observability fields persisted on the card
    assert card["digest_method"] in {"gemini", "sec_8k_items", "heuristic_8k"} or card["digest_method"]
    assert "classification_method" in card
    assert card["bundle_chars_primary"] == 4200
    assert card["bundle_chars_exhibit"] == 18000
    assert card["exhibit_names"] == ["ex99-1.htm"]
    assert card["exhibit_fetch_mode"] == "forced"


def test_last_wednesday_cutoff_before_and_after():
    tue = datetime(2026, 9, 15, 18, 0, tzinfo=_ROME)  # Tuesday
    wed_early = datetime(2026, 9, 16, 7, 0, tzinfo=_ROME)
    wed_late = datetime(2026, 9, 16, 8, 0, tzinfo=_ROME)
    prev = last_wednesday_cutoff(tue)
    assert prev.date().isoformat() == "2026-09-09"
    assert last_wednesday_cutoff(wed_early).date().isoformat() == "2026-09-09"
    assert last_wednesday_cutoff(wed_late).date().isoformat() == "2026-09-16"
    nxt = next_wednesday_iso(wed_late)
    assert nxt.startswith("2026-09-23")


def test_cache_fresh_requires_digest_version():
    from ticker_8k_dossier import _DIGEST_VERSION, _cache_fresh

    now = datetime(2026, 9, 16, 18, 0, tzinfo=_ROME)
    stale = {"updated_at": now.isoformat(), "digest_version": 1}
    assert _cache_fresh(stale, now) is False
    fresh = {"updated_at": now.isoformat(), "digest_version": _DIGEST_VERSION}
    assert _cache_fresh(fresh, now) is True
    assert _DIGEST_VERSION >= 3


def test_normalize_gemini_paragraphs_caps_and_titles():
    from ticker_8k_dossier import _normalize_gemini_paragraphs

    parsed = {
        "paragraphs": [
            {
                "item": "7.01",
                "title": "Mint US commercial launch",
                "summary": " ".join(f"word{i}" for i in range(80)),
            },
            {
                "item": "8.01",
                "title": "FDA clearance of Mint",
                "summary": "FDA cleared the Mint patch pump on 14 September 2026.",
            },
        ]
    }
    out = _normalize_gemini_paragraphs(
        parsed,
        item_titles={"7.01": "Regulation FD Disclosure", "8.01": "Other Events"},
    )
    assert len(out) == 2
    assert out[0]["item"] == "7.01"
    assert out[0]["item_title"] == "Regulation FD Disclosure"
    assert out[0]["title"] == "Mint US commercial launch"
    assert len(out[0]["summary"].split()) == _SUMMARY_MAX_WORDS
    assert out[1]["title"] == "FDA clearance of Mint"
    assert "FDA cleared" in out[1]["summary"]


def test_digest_filing_uses_gemini_paragraphs(monkeypatch):
    from ticker_8k_dossier import _digest_filing

    monkeypatch.setattr(
        "ticker_8k_dossier._call_8k_summarizer",
        lambda prompt, system: (
            '{"paragraphs":[{"item":"2.02","title":"Q2 revenue and EPS",'
            '"summary":"Biogen posted $2.4 billion Q2 product revenue and $4.01 GAAP diluted EPS, '
            "citing Vumerity growth, a higher cash balance, and lower operating expenses after "
            'restructuring. Cash ended the quarter at $1.1 billion."}]}'
        ),
    )
    text = """
Item 2.02 Results of Operations and Financial Condition.
On July 29, 2026, Biogen Inc. reported second quarter product revenue of $2.4 billion
and GAAP diluted EPS of $4.01.
"""
    card = _digest_filing(
        ticker="BIIB",
        text=text,
        filing_date="2026-07-29",
        url="https://www.sec.gov/Archives/example.htm",
    )
    assert card["digest_method"] == "gemini"
    sess = card["sessions"][0]
    assert sess["title"] == "Q2 revenue and EPS"
    assert sess["item"] == "2.02"
    assert len(sess["summary"].split()) <= _SUMMARY_MAX_WORDS
    assert "2.4" in sess["summary"] or "revenue" in sess["summary"].lower()


def test_system_prompt_requires_concrete_fact():
    from ticker_8k_dossier import _SYSTEM_8K

    assert "MUST include at least one concrete fact" in _SYSTEM_8K
    assert "no financial terms disclosed" in _SYSTEM_8K
    assert "65" in _SYSTEM_8K

def test_digest_6k_without_items_builds_session(monkeypatch):
    """Foreign issuers file 6-K with no Item.N — still produce a UI card."""
    from ticker_8k_dossier import _digest_filing

    monkeypatch.setattr(
        "ticker_8k_dossier._call_8k_summarizer",
        lambda prompt, system: (
            '{"paragraphs":[{"item":"6-K","title":"Warrant exercise proceeds",'
            '"summary":"Cardiol received over USD $7 million from warrant exercises, '
            "extending cash runway into H1 2028 ahead of Phase III MAVERIC topline."
            '"}]}'
        ),
    )
    text = """
FORM 6-K
REPORT OF FOREIGN PRIVATE ISSUER
Cardiol Therapeutics Inc.
FOR IMMEDIATE RELEASE
Cardiol Therapeutics Announces Warrant Exercise for Over USD $7 Million in Proceeds
TORONTO, Sept. 16, 2026 — Cardiol received over USD $7 million from the exercise
of outstanding common share purchase warrants.
"""
    card = _digest_filing(
        ticker="CRDL",
        text=text,
        filing_date="2026-09-16",
        url="https://www.sec.gov/Archives/example-6k.htm",
        form_type="6-K",
    )
    assert card["form"] == "6-K"
    assert card["sessions"]
    assert card["sessions"][0]["summary"]
    assert (
        "7" in card["sessions"][0]["summary"]
        or "warrant" in card["sessions"][0]["summary"].lower()
    )
