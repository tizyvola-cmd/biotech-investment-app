"""Daily News migrate attaches EIS on publish day and creates a stub card if needed."""

from __future__ import annotations

from daily_news_desk import _ensure_daily_news_clinical_stub, _item_to_eis_event


def test_item_to_eis_event_prefers_published_at_over_catalyst_event_date():
    ev = _item_to_eis_event(
        {
            "ticker": "VRTX",
            "title": "Vertex completes Crinetics acquisition",
            "published_at": "2026-09-15",
            "event_date": "2026-11-01",  # future catalyst — must not win
            "eis_score": 2.5,
            "eis": {"score": 2.5, "sentiment": 0.4},
        },
        default_date="2026-09-15",
        pending=False,
    )
    assert ev is not None
    assert ev["event_date"] == "2026-09-15"
    # Market EIS stays unset at migrate — filled later at 12/24/36h.
    assert ev["eis_score"] is None
    assert ev["eis"].get("score") is None
    assert ev["_from_daily_news"] is True
    assert ev["reference_match"] == "daily_news"


def test_item_to_eis_event_fda_briefing_session_fields():
    ev = _item_to_eis_event(
        {
            "ticker": "AMGN",
            "title": "FDA AdCom briefing · Aranesp (darbepoetin alfa) (AMGN)",
            "published_at": "2026-09-22",
            "source_kind": "fda_briefing",
            "digest_method": "fda_briefing",
            "fda_adcom_id": "2026-09-16-AMGN",
            "fda_stance": "negative",
            "fda_score": -10.0,
            "clinical_score": -2.86,
            "investor_insight": "Product path: FAERS death reports…",
            "section_summaries": [{"heading": "Results", "summary": "94 reports"}],
            "link": "https://www.fda.gov/media/194269/download",
            "product": "Aranesp",
        },
        default_date="2026-09-22",
        pending=False,
    )
    assert ev is not None
    assert ev["source_type"] == "fda_briefing"
    assert ev["event_type"] == "fda_briefing"
    assert ev["is_paper"] is False
    assert ev["reference_match"] == "fda_briefing"
    assert ev["link_label"] == "FDA Briefing"
    assert ev["fda_stance"] == "negative"
    assert ev["fda_adcom_id"] == "2026-09-16-AMGN"
    assert ev["eis_horizons_pending"] == ["12h", "24h", "36h"]
    assert ev["eis_score"] is None
    assert "FDA Briefings" in str(ev.get("impact_note") or "")


def test_ensure_stub_creates_ticker_card_when_missing():
    records: list = []
    by_ticker: dict = {}
    targets = _ensure_daily_news_clinical_stub(
        ticker="VRTX",
        company="Vertex Pharmaceuticals",
        records=records,
        by_ticker=by_ticker,
    )
    assert len(targets) == 1
    assert targets[0]["ticker"] == "VRTX"
    assert len(records) == 1
    # Second call reuses the stub
    again = _ensure_daily_news_clinical_stub(
        ticker="VRTX",
        company="Vertex Pharmaceuticals",
        records=records,
        by_ticker=by_ticker,
    )
    assert again[0] is targets[0]
    assert len(records) == 1
