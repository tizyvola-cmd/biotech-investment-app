"""8-K taxonomy classifier (system prompt) — no free sentiment."""
from __future__ import annotations

from eis_taxonomy_scoring import (
    classify_8k_filing_result,
    detect_8k_items,
    magnitude_to_modifier_ids,
    build_8k_system_prompt,
)


def test_detect_8k_items():
    text = "Item 7.01 Regulation FD Disclosure. Item 9.01 Financial Statements."
    assert detect_8k_items(text) == ["7.01", "9.01"]


def test_magnitude_maps_to_modifiers():
    mods = magnitude_to_modifier_ids(
        {
            "trial_phase": "phase3",
            "statistical_significance": "p<0.01",
            "amount_pct_market_cap": "over_20",
            "surprise_vs_expected": None,
        }
    )
    assert "trial_phase_phase3" in mods
    assert "statistical_significance_p_lt_0_01" in mods
    assert "amount_pct_market_cap_over_20" in mods


def test_8k_system_prompt_lists_excel_ids():
    prompt = build_8k_system_prompt()
    assert "CLIN_PRIMARY_MET" in prompt
    assert "FIN_DILUTIVE_OFFERING" in prompt
    assert "never assign a sentiment score" in prompt.lower() or "CLASSIFICATION AND EXTRACTION ONLY" in prompt


def test_classify_8k_offering_scores_financial():
    obj = {
        "items_detected": ["7.01", "9.01"],
        "classifications": {
            "clinical": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "financial": {
                "event_id": "FIN_DILUTIVE_OFFERING",
                "evidence_quote": "announcing the pricing of an Offering",
                "magnitude": {"amount_pct_market_cap": "5_to_20"},
            },
            "corporate": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": (
            "On September 9, 2026, the company announced the pricing of an equity offering, "
            "with the press release attached as Exhibit 99.1 under Item 7.01."
        ),
    }
    classified = classify_8k_filing_result(obj)
    fin = classified["dimensions"]["financial"]
    assert fin["event_id"] == "FIN_DILUTIVE_OFFERING"
    assert fin["score"] == -1.5  # base -1.5 × 1.0 for 5_to_20
    assert "Disclosure" in classified["title"] or "7.01" in classified["title"] or "Offering" in classified["title"] or "Offerta" in classified["title"]


def test_card_title_event_label_is_english():
    from eis_taxonomy_scoring import event_type_en

    assert event_type_en("CLIN_TOPLINE_POSITIVE") == "Positive topline / interim results"
    # Unknown ID added to the taxonomy later still renders readable English.
    assert event_type_en("CLIN_SOMETHING_NEW") == "Something new"
    assert event_type_en(None, "fallback") == "fallback"

    obj = {
        "items_detected": ["7.01", "8.01", "9.01"],
        "classifications": {
            "clinical": {
                "event_id": "CLIN_TOPLINE_POSITIVE",
                "evidence_quote": "met its primary endpoint",
                "magnitude": {"trial_phase": "phase2"},
            },
            "financial": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "corporate": {"event_id": None, "evidence_quote": None, "magnitude": {}},
            "market_access": {"event_id": None, "evidence_quote": None, "magnitude": {}},
        },
        "unclassified_notes": [],
        "narrative_summary": "Positive Phase 2 topline data in ulcerative colitis.",
    }
    title = classify_8k_filing_result(obj)["title"]
    assert "Positive topline" in title
    assert "Risultati" not in title


def test_parse_edgar_url():
    from daily_news_desk import _parse_edgar_filing_url

    u = (
        "https://www.sec.gov/Archives/edgar/data/1979414/"
        "000182912626009977/neonctechnologies_8k.htm"
    )
    p = _parse_edgar_filing_url(u)
    assert p is not None
    assert p["cik10"] == "0001979414"
    assert p["accession"] == "0001829126-26-009977"
    assert p["primary_doc"] == "neonctechnologies_8k.htm"


def test_format_dilutive_offering_summary_en_nthi_shape():
    from eis_taxonomy_scoring import (
        format_dilutive_offering_summary,
        heuristic_8k_classification_obj,
        classify_8k_filing_result,
        classification_to_score_fields,
    )

    sample = """
    Item 1.01 Entry into a Material Definitive Agreement.
    Item 7.01 Regulation FD Disclosure.
    COMPANY CONFORMED NAME: NEONC TECHNOLOGIES HOLDINGS, INC.
    On September 8, 2026, NeOnc Technologies Holdings, Inc. entered into securities
    purchase agreements relating to the registered direct offering and sale of an
    aggregate of 2,610,715 shares (the Shares) of the Company's common stock, par value
    $0.0001 per share (the Common Stock), pre-funded warrants (the Pre-Funded Warrants)
    to purchase up to 960,715 shares of Common Stock, and accompanying warrants to
    purchase up to an aggregate of 3,571,430 shares of Common Stock (the Warrants and
    the offering of the Shares, the Pre-Funded Warrants and the Warrants, the Offering)
    at a combined offering price of $4.20 per Share and accompanying Warrant.
    The gross proceeds to the Company from the Offering will be approximately $15 million,
    before deducting Placement Agent fees. The Company expects to use the net proceeds
    from the Offering for working capital and general corporate purposes and for the
    redemption of Series A Convertible Preferred Stock. The Offering is expected to close
    on September 10, 2026. The Warrants have an exercise price of $4.20 per share and will
    expire five years. Pre-Funded Warrant exercise price of $0.0001 per share.
    CEO and Chief Medical Officer agreed to a 90 day lock-up. 30 day registration statement
    restriction except Form S-8. Placement Agents Roth Capital Partners and A.G.P.
    Alliance Global Partners; 7.0% of the aggregate gross proceeds.
    """
    en = format_dilutive_offering_summary(
        text=sample,
        ticker="NTHI",
        filing_date="2026-09-10",
        event_date="2026-09-08",
    )
    assert en is not None
    assert "2,610,715" in en
    assert "$4.20" in en
    assert "960,715" in en
    assert "3,571,430" in en
    assert "$15" in en
    assert "FIN_" not in en  # narrative is prose, not IDs
    assert "Source: 8-K" in en
    assert "announced a registered direct offering" in en
    assert "ha comunicato" not in en
    assert "Fonte:" not in en
    assert "settembre" not in en.lower()

    obj = heuristic_8k_classification_obj(
        text=sample, ticker="NTHI", filing_date="2026-09-10", event_date="2026-09-08"
    )
    assert obj is not None
    assert obj["classifications"]["financial"]["event_id"] == "FIN_DILUTIVE_OFFERING"
    assert "announced" in str(obj.get("narrative_summary") or "").lower()
    scored = classification_to_score_fields(classify_8k_filing_result(obj))
    assert scored["financial_score"] == -1.5


def test_is_sec_edgar_archives_url_casefold():
    from daily_news_desk import _is_sec_edgar_archives_url

    u = (
        "https://www.sec.gov/Archives/edgar/data/1979414/"
        "000182912626009977/neonctechnologies_8k.htm"
    )
    assert _is_sec_edgar_archives_url(u) is True
    # Regression: never match capital-A needle against .lower()'d URL
    assert "sec.gov/Archives/edgar/" not in u.lower()
    assert "sec.gov/archives/edgar/" in u.lower()


def test_fetch_url_text_direct_sec_uses_edgar(monkeypatch):
    """Manual News Analyze must not hit sec.gov with browser UA (http_403)."""
    import daily_news_desk as desk

    u = (
        "https://www.sec.gov/Archives/edgar/data/1979414/"
        "000182912626009977/neonctechnologies_8k.htm"
    )
    calls: list[str] = []

    def fake_edgar(url: str):
        calls.append(url)
        return ("Item 7.01 Regulation FD Disclosure. " * 20).strip(), None

    monkeypatch.setattr(desk, "_fetch_edgar_8k_text_from_url", fake_edgar)
    body, err = desk._fetch_url_text_direct(u)
    assert err is None
    assert "Item 7.01" in body
    assert calls == [u]

    body2, err2 = desk._fetch_url_text(u)
    assert err2 is None
    assert "Item 7.01" in body2


_NTHI_COVER = """
UNITED STATES
SECURITIES AND EXCHANGE COMMISSION
Washington, D.C. 20549
FORM 8-K
CURRENT REPORT
Pursuant to Section 13 or 15(d)
Date of Report (Date of earliest event reported): September 8, 2026
NEONC TECHNOLOGIES HOLDINGS, INC.
Commission File Number: 001-42535
Central Index Key: 0001979414
Exact Name of Registrant as Specified in its Charter: NeOnc Technologies Holdings, Inc.
"""

_NTHI_ITEMS = """
Item 1.01 Entry into a Material Definitive Agreement.

On September 8, 2026, NeOnc Technologies Holdings, Inc. entered into securities
purchase agreements relating to the registered direct offering and sale of an
aggregate of 2,610,715 shares of the Company's common stock, pre-funded warrants
to purchase up to 960,715 shares, and accompanying warrants to purchase up to
3,571,430 shares at a combined offering price of $4.20 per Share. Gross proceeds
approximately $15 million. The Offering is expected to close on September 10, 2026.

Item 7.01 Regulation FD Disclosure.

The Company hereby furnishes a press release announcing the pricing of the Offering
as Exhibit 99.1. The information in this Item 7.01 shall not be deemed "filed"
for purposes of Section 18 of the Exchange Act.

Item 9.01 Financial Statements and Exhibits.

(d) Exhibits
Exhibit 10.1 Form of Securities Purchase Agreement
Exhibit 99.1 Press Release dated September 9, 2026
"""


def test_segment_8k_cover_excluded_from_items():
    from daily_news_desk import _segment_8k_filing

    text = _NTHI_COVER + "\n" + _NTHI_ITEMS
    seg = _segment_8k_filing(text)
    assert "FORM 8-K" in seg["cover"] or "NEONC" in seg["cover"].upper()
    codes = [it["item"] for it in seg["items"]]
    assert codes == ["1.01", "7.01", "9.01"]
    for it in seg["items"]:
        assert "FORM 8-K" not in it["body"]
        assert "Commission File Number" not in it["body"]
    assert "registered direct" in seg["body_without_cover"].lower()
    assert "FORM 8-K" not in seg["body_without_cover"]


def test_news_kind_from_items_financial_not_ma():
    from daily_news_desk import _news_kind_from_8k_items

    items = [
        {"item": "1.01", "title": "Entry into a Material Definitive Agreement"},
        {"item": "7.01", "title": "Regulation FD Disclosure"},
    ]
    body = "registered direct offering securities purchase agreement definitive agreement"
    assert _news_kind_from_8k_items(items, body_hint=body) == "financial"


def test_news_kind_item_201_is_ma():
    from daily_news_desk import _news_kind_from_8k_items

    assert (
        _news_kind_from_8k_items(
            [{"item": "2.01", "title": "Completion of Acquisition or Disposition of Assets"}],
            body_hint="completed the acquisition of TargetCo",
        )
        == "ma"
    )


def test_news_kind_item_502_is_other():
    from daily_news_desk import _news_kind_from_8k_items

    assert (
        _news_kind_from_8k_items(
            [{"item": "5.02", "title": "Departure of Directors or Certain Officers"}],
            body_hint="Chief Executive Officer resigned effective today",
        )
        == "other"
    )


def test_news_kind_item_801_clinical():
    from daily_news_desk import _news_kind_from_8k_items

    assert (
        _news_kind_from_8k_items(
            [{"item": "8.01", "title": "Other Events"}],
            body_hint="announced Phase 3 topline clinical trial primary endpoint",
        )
        == "clinical"
    )


def test_build_sec_8k_structured_brief_nthi(monkeypatch):
    from daily_news_desk import _build_sec_8k_structured_brief
    import daily_news_desk as desk

    # Avoid live LLM / network in classify
    def fake_classify(**kwargs):
        return {
            "title": "NTHI — September 10, 2026",
            "narrative_summary": (
                "NTHI — September 10, 2026 (event date September 8, 2026)\n\n"
                "NeOnc announced a registered direct offering of about $15 million "
                "at $4.20 per share."
            ),
            "clinical_score": 0.0,
            "financial_score": -1.5,
            "corporate_score": 0.0,
            "market_access_score": 0.0,
            "eis_score": -1.5,
            "taxonomy_method": "heuristic_8k",
            "taxonomy_dimensions": {
                "financial": {"event_id": "FIN_DILUTIVE_OFFERING", "score": -1.5}
            },
        }

    monkeypatch.setattr(
        "eis_taxonomy_scoring.classify_8k_filing",
        fake_classify,
        raising=False,
    )
    # Patch import path used inside the function
    import eis_taxonomy_scoring as tax

    monkeypatch.setattr(tax, "classify_8k_filing", fake_classify)
    monkeypatch.setattr(
        "ticker_8k_dossier._gemini_paragraphs_for_filing",
        lambda **k: None,
        raising=False,
    )

    text = _NTHI_COVER + "\n" + _NTHI_ITEMS
    brief = _build_sec_8k_structured_brief(
        text=text,
        ticker="NTHI",
        title_hint="NTHI 8-K",
        url="https://www.sec.gov/Archives/edgar/data/1979414/000182912626009977/neonctechnologies_8k.htm",
        filing_date="2026-09-10",
    )
    assert brief["news_kind"] == "financial"
    assert brief["skip_page_check"] is True
    assert brief["digest_answers"] == []
    assert brief["digest_method"] == "sec_8k_items"
    assert brief["item_summaries"]
    codes = [x["item"] for x in brief["item_summaries"]]
    assert codes == ["1.01", "7.01", "9.01"] or (
        "1.01" in codes and "7.01" in codes and len(codes) == len(set(codes))
    )
    joined = " ".join(x["summary"] for x in brief["item_summaries"])
    assert "FORM 8-K" not in joined
    assert "Commission File Number" not in joined
    assert "Washington, D.C." not in joined
    assert "PAGE CHECK" not in str(brief).upper()
    assert brief["financial_score"] == -1.5


def test_build_sec_8k_gemini_paragraph_summaries(monkeypatch):
    from daily_news_desk import _build_sec_8k_structured_brief

    def fake_classify(**kwargs):
        return {
            "title": "Other Events: Dilutive equity offering / shelf takedown",
            "narrative_summary": "Beta Bionics priced a $150 million public offering.",
            "clinical_score": 0.0,
            "financial_score": -0.35,
            "corporate_score": 0.0,
            "market_access_score": 0.0,
            "eis_score": -0.35,
            "taxonomy_method": "heuristic_8k",
            "taxonomy_dimensions": {
                "financial": {"event_id": "FIN_DILUTIVE_OFFERING", "score": -0.35}
            },
        }

    monkeypatch.setattr(
        "eis_taxonomy_scoring.classify_8k_filing",
        fake_classify,
        raising=False,
    )
    import eis_taxonomy_scoring as tax

    monkeypatch.setattr(tax, "classify_8k_filing", fake_classify)
    monkeypatch.setattr(
        "ticker_8k_dossier._gemini_paragraphs_for_filing",
        lambda **k: [
            {
                "item": "8.01",
                "item_title": "Other Events",
                "title": "Public offering priced at $17.25",
                "summary": (
                    "Beta Bionics sold 7.65 million shares at $17.25 and pre-funded "
                    "warrants for 1.04 million shares, targeting about $150 million "
                    "gross proceeds, with close expected 17 September 2026."
                ),
            },
            {
                "item": "8.01",
                "item_title": "Other Events",
                "title": "Use of proceeds for Mint",
                "summary": (
                    "Net proceeds are earmarked for Mint commercialization, "
                    "manufacturing expansion, R&D and clinical work, product "
                    "enhancements, possible strategic deals, and working capital."
                ),
            },
            {
                "item": "9.01",
                "item_title": "Financial Statements and Exhibits",
                "title": "Underwriting and press-release exhibits",
                "summary": (
                    "The filing attaches the J.P. Morgan underwriting agreement, "
                    "pre-funded warrant form, Cooley legality opinion, and two "
                    "15 September 2026 press releases on launch and pricing."
                ),
            },
        ],
    )
    text = (
        "Item 8.01 Other Events.\n"
        "On September 15, 2026, Beta Bionics, Inc. entered into an underwriting "
        "agreement with J.P. Morgan relating to 7,652,175 shares at $17.25.\n\n"
        "Item 9.01 Financial Statements and Exhibits.\n"
        "Exhibit 1.1 Underwriting Agreement. Exhibit 99.1 Press Release.\n"
    )
    brief = _build_sec_8k_structured_brief(
        text=text,
        ticker="BBNX",
        title_hint="BBNX 8-K",
        url="https://www.sec.gov/Archives/edgar/data/1674632/000119312526393322/d178069d8k.htm",
        filing_date="2026-09-16",
    )
    assert brief["digest_method"] == "sec_8k_gemini"
    secs = brief.get("section_summaries") or []
    assert len(secs) == 3
    headings = " ".join(s["heading"] for s in secs)
    assert "Public offering priced at $17.25" in headings
    assert "Use of proceeds for Mint" in headings
    assert all(len(s["summary"].split()) <= 50 for s in secs)
    assert "entered into an underwriting agreement (the" not in str(
        brief.get("detail_summary") or ""
    )


