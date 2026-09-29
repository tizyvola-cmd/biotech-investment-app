"""Daily News migrate routes clinical → Clinical tab, financial → Financial dossier."""

from __future__ import annotations

from daily_news_desk import (
    _daily_news_migrate_lane,
    _item_to_financial_filing,
    _strip_daily_news_from_clinical_records,
)


def test_lane_fda_briefing_routes_clinical():
    assert (
        _daily_news_migrate_lane(
            {
                "source_kind": "fda_briefing",
                "title": "FDA AdCom briefing · Aranesp",
                "link": "https://www.fda.gov/media/194269/download",
            }
        )
        == "clinical"
    )


def test_lane_news_kind_clinical():
    assert _daily_news_migrate_lane({"news_kind": "clinical"}) == "clinical"


def test_lane_news_kind_financial_ma_litigation():
    assert _daily_news_migrate_lane({"news_kind": "financial"}) == "financial"
    assert _daily_news_migrate_lane({"news_kind": "ma"}) == "financial"
    assert _daily_news_migrate_lane({"news_kind": "litigation"}) == "financial"


def test_lane_taxonomy_financial_without_clinical():
    assert (
        _daily_news_migrate_lane(
            {
                "taxonomy_dimensions": {
                    "financial": {"event_id": "FIN_ATM"},
                    "clinical": {"event_id": None},
                }
            }
        )
        == "financial"
    )


def test_lane_score_magnitude_prefers_clinical():
    assert (
        _daily_news_migrate_lane(
            {"clinical_score": -1.5, "financial_score": -0.2, "news_kind": "other"}
        )
        == "clinical"
    )


def test_lane_score_magnitude_prefers_financial():
    assert (
        _daily_news_migrate_lane(
            {"clinical_score": 0.1, "financial_score": -1.8, "news_kind": "other"}
        )
        == "financial"
    )


def test_lane_sec_source_is_financial():
    assert _daily_news_migrate_lane({"source_kind": "sec_8k", "title": "8-K"}) == "financial"


def test_lane_default_press_is_clinical():
    assert (
        _daily_news_migrate_lane(
            {"title": "Phase 3 topline results", "source_kind": "press"}
        )
        == "clinical"
    )


def test_item_to_financial_filing_shape():
    card = _item_to_financial_filing(
        {
            "id": "dn-1",
            "ticker": "BBNX",
            "title": "Shareholder alert lawsuit",
            "news_kind": "litigation",
            "financial_score": -1.0,
            "published_at": "2026-09-17",
            "link": "https://example.com/x",
            "summary_long": "Kirby McInerney LLP filed a securities fraud lawsuit on behalf of shareholders.",
        },
        default_date="2026-09-17",
    )
    assert card is not None
    assert card["form"] == "News"
    assert card["financial_score"] == -1.0
    assert card["_from_daily_news"] is True
    assert card["_daily_news_id"] == "dn-1"
    assert card["sessions"][0]["item"] == "DN"


def test_strip_daily_news_from_clinical_records():
    records = [
        {
            "ticker": "BBNX",
            "clinical_events": [
                {"_daily_news_id": "dn-1", "event_title": "lawsuit"},
                {"_daily_news_id": "dn-2", "event_title": "trial"},
            ],
            "timeline_events": [
                {"_daily_news_id": "dn-1", "event_title": "lawsuit"},
                {"_daily_news_id": "dn-2", "event_title": "trial"},
            ],
        }
    ]
    n = _strip_daily_news_from_clinical_records(
        records, ticker="BBNX", daily_news_id="dn-1"
    )
    assert n == 2
    assert len(records[0]["clinical_events"]) == 1
    assert records[0]["clinical_events"][0]["_daily_news_id"] == "dn-2"


def test_append_migrated_survives_lookup_merge(tmp_path, monkeypatch):
    import ticker_8k_dossier as d

    cache_path = tmp_path / "ticker_8k_dossier_cache.json"
    monkeypatch.setattr(d, "_CACHE_PATH", cache_path)
    monkeypatch.setattr(d, "_cache_fresh", lambda _hit: True)

    filing = {
        "filing_date": "2026-09-17",
        "form": "News",
        "title": "ATM offering",
        "financial_score": -1.2,
        "_from_daily_news": True,
        "_daily_news_id": "dn-atm",
        "sessions": [{"item": "DN", "item_title": "Daily News", "title": "ATM", "summary": "ATM."}],
    }
    out = d.append_migrated_daily_news_filing(ticker="TEST", filing=filing)
    assert out["ok"] is True

    # Seed an EDGAR-only dossier then force merge path via lookup cache hit.
    cache = d._load_cache()
    entry = cache["entries"]["TEST"]
    entry["dossier"]["filings"] = [
        {
            "filing_date": "2026-09-01",
            "form": "8-K",
            "title": "EDGAR filing",
            "financial_score": 0.5,
        }
    ]
    d._save_cache(cache)

    res = d.lookup_ticker_8k_dossier(ticker="TEST", force=False)
    assert res["ok"] is True
    titles = [f.get("title") for f in (res["dossier"].get("filings") or [])]
    assert "ATM offering" in titles
    assert "EDGAR filing" in titles
