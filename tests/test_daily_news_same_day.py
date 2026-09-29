"""Daily News desk: same Rome calendar day only; migrated rows leave the box."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo


def _rome_today_iso() -> str:
    return datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()


def test_row_is_desk_fresh_same_day_only():
    import daily_news_desk as desk

    today = _rome_today_iso()
    yesterday = (
        datetime.now(ZoneInfo("Europe/Rome")).date() - timedelta(days=1)
    ).isoformat()
    assert desk._DESK_FRESHNESS_DAYS == 1
    assert desk._row_is_desk_fresh({"published_at": today}, today=today)
    # Yesterday is stale on a trading day; on weekends Friday may still qualify
    # (see test_row_is_desk_fresh_weekend_keeps_last_session).
    from us_equity_session import is_nyse_trading_day

    trading, _ = is_nyse_trading_day(datetime.now(ZoneInfo("Europe/Rome")).date())
    if trading:
        assert not desk._row_is_desk_fresh({"published_at": yesterday}, today=today)
        assert not desk._row_is_same_rome_day({"published_at": yesterday}, today=today)
    assert not desk._row_is_desk_fresh({"published_at": "2020-01-01"}, today=today)
    assert not desk._row_is_desk_fresh({"title": "No date"}, today=today)


def test_row_is_desk_fresh_weekend_keeps_last_session():
    import daily_news_desk as desk

    # Sun 2026-09-20 → last NYSE session Fri 2026-09-18
    sunday = "2026-09-20"
    friday = "2026-09-18"
    thursday = "2026-09-17"
    assert desk._row_is_desk_fresh({"published_at": friday}, today=sunday)
    assert not desk._row_is_desk_fresh({"published_at": thursday}, today=sunday)
    assert not desk._row_is_desk_fresh({"published_at": "2026-09-14"}, today=sunday)


def test_migrated_rows_hidden_from_desk_payload(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    desk._write(
        {
            "rome_date": today,
            "items": [],
            "highlights": [],
            "top_news": [
                {
                    "id": "gone",
                    "ticker": "CRDL",
                    "title": "Migrated PR",
                    "link": "https://example.com/m",
                    "published_at": today,
                    "event_date": today,
                    "migrated_to_eis": True,
                    "eis_score": 2.0,
                },
                {
                    "id": "live",
                    "ticker": "CRDL",
                    "title": "Still staged",
                    "link": "https://example.com/l",
                    "published_at": today,
                    "event_date": today,
                    "eis_score": 1.0,
                },
            ],
            "user_analyses": [
                {
                    "id": "man1",
                    "summary_10w": "Manual migrated",
                    "published_at": today,
                    "migrated_to_eis": True,
                }
            ],
        }
    )
    out = desk.load_daily_news()
    ids = {r.get("id") for r in (out.get("top_news") or [])}
    assert ids == {"live"}
    assert out.get("user_analyses") == []
    disk = desk._read()
    assert {r.get("id") for r in (disk.get("top_news") or [])} == {"live"}


def test_load_daily_news_prunes_stale_top(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    yesterday = (
        datetime.now(ZoneInfo("Europe/Rome")).date() - timedelta(days=1)
    ).isoformat()
    desk._write(
        {
            "rome_date": today,
            "items": [],
            "highlights": [],
            "top_news": [
                {
                    "id": "old",
                    "ticker": "CRDL",
                    "title": "Ancient PR",
                    "link": "https://example.com/old",
                    "published_at": "2020-06-01",
                    "event_date": "2020-06-01",
                    "eis_score": 2.0,
                },
                {
                    "id": "yest",
                    "ticker": "CRDL",
                    "title": "Yesterday PR",
                    "link": "https://example.com/mid",
                    "published_at": yesterday,
                    "event_date": yesterday,
                    "eis_score": 1.5,
                },
                {
                    "id": "new",
                    "ticker": "CRDL",
                    "title": "Today PR",
                    "link": "https://example.com/new",
                    "published_at": today,
                    "event_date": today,
                    "eis_score": 1.0,
                },
            ],
            "user_analyses": [],
        }
    )
    out = desk.load_daily_news()
    ids = {r.get("id") for r in (out.get("top_news") or [])}
    assert ids == {"new"}
    disk = desk._read()
    assert {r.get("id") for r in (disk.get("top_news") or [])} == {"new"}


def test_build_top_news_drops_stale_previous(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    desk._write(
        {
            "top_news": [
                {
                    "id": "old",
                    "ticker": "CRDL",
                    "title": "Old",
                    "link": "https://example.com/old",
                    "published_at": "2020-01-01",
                    "event_date": "2020-01-01",
                    "eis_score": 0.5,
                }
            ],
            "items": [],
            "highlights": [],
            "user_analyses": [],
        }
    )

    fresh: list[dict[str, Any]] = [
        {
            "id": "new1",
            "ticker": "CRDL",
            "title": "Fresh press",
            "link": "https://example.com/new",
            "eis_score": 2.0,
            "source_kind": "press",
            "published_at": today,
            "event_date": today,
        }
    ]
    monkeypatch.setattr(desk, "_company_map", lambda: {"CRDL": "Cardiol"})
    monkeypatch.setattr(desk, "_press_rows_for_ticker", lambda *a, **k: fresh)
    monkeypatch.setattr(desk, "_recent_8k_digests_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "cache_staged_daily_news_to_clinical", lambda **k: None)

    out = desk.build_top_news(["CRDL"], force=True)
    ids = {r.get("id") for r in (out.get("top_news") or [])}
    assert ids == {"new1"}


def test_build_top_news_empty_priority_does_not_wipe(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    desk._write(
        {
            "rome_date": today,
            "top_news": [
                {
                    "id": "keep",
                    "ticker": "CRDL",
                    "title": "Keep me",
                    "link": "https://example.com/k",
                    "published_at": today,
                    "event_date": today,
                }
            ],
            "top_news_tickers": ["CRDL"],
            "items": [],
            "highlights": [],
            "user_analyses": [],
        }
    )
    out = desk.build_top_news([], force=True)
    assert out.get("skipped_empty_priority") is True
    assert {r.get("id") for r in (out.get("top_news") or [])} == {"keep"}
    assert desk._read().get("top_news_tickers") == ["CRDL"]


def test_press_rows_skip_old_event_date(monkeypatch, tmp_path):
    import daily_news_desk as desk

    monkeypatch.setattr(desk, "_PATH", tmp_path / "daily_news_desk.json")
    desk._write({})
    yesterday = (
        datetime.now(ZoneInfo("Europe/Rome")).date() - timedelta(days=1)
    ).isoformat()
    monkeypatch.setattr(
        desk,
        "_fetch_company_news",
        lambda *a, **k: [
            {
                "title": "Old filing news",
                "link": "https://example.com/a",
                "summary": "",
                "event_date": "2020-01-01",
            },
            {
                "title": "Yesterday news",
                "link": "https://example.com/b",
                "summary": "",
                "event_date": yesterday,
            },
            {
                "title": "Today news",
                "link": "https://example.com/c",
                "summary": "",
                "event_date": _rome_today_iso(),
            },
        ],
    )
    rows = desk._press_rows_for_ticker("CRDL", "Cardiol")
    titles = {r["title"] for r in rows}
    assert "Old filing news" not in titles
    assert "Yesterday news" not in titles
    assert "Today news" in titles


def test_fetch_company_news_query_is_when_1d(monkeypatch):
    import daily_news_desk as desk

    captured: list[str] = []

    def fake_rss(query: str, max_items: int = 10):
        captured.append(query)
        return []

    monkeypatch.setattr(
        "press_release_fetch._fetch_google_news_rss",
        fake_rss,
    )
    desk._fetch_company_news("CRDL", "Cardiol Therapeutics")
    assert captured
    assert "when:1d" in captured[0]


def test_build_highlights_includes_all_staged_not_only_extremes():
    import daily_news_desk as desk

    items = [
        {"id": "a", "status": "staged", "title": "pos", "eis_score": 2.0, "ticker": "AAA"},
        {"id": "b", "status": "staged", "title": "mild", "eis_score": 0.1, "ticker": "BBB"},
        {"id": "c", "status": "staged", "title": "zero", "eis_score": 0.0, "ticker": "CCC"},
        {"id": "d", "status": "staged", "title": "null", "eis_score": None, "ticker": "DDD"},
        {"id": "e", "status": "staged", "title": "neg", "eis_score": -1.5, "ticker": "EEE"},
        {"id": "f", "status": "migrated", "title": "gone", "eis_score": 9.0, "ticker": "FFF"},
        {"id": "g", "status": "staged", "title": "dismissed", "eis_score": 3.0, "dismissed": True},
    ]
    out = desk._build_highlights(items)
    ids = [x["id"] for x in out]
    assert ids == ["a", "e", "b", "c", "d"]  # |EIS| desc; zeros/nulls included
    assert "f" not in ids and "g" not in ids


_KIDS_BRONCOS = (
    "Denver Broncos travel to elementary schools to get kids excited "
    "about football - CBS News"
)


def test_kids_english_headline_is_not_ticker_kids():
    import daily_news_desk as desk

    assert not desk._blob_mentions_ticker(
        _KIDS_BRONCOS, "", "KIDS", "OrthoPediatrics Corp."
    )
    assert not desk._row_ticker_is_grounded(
        {
            "ticker": "KIDS",
            "company": "OrthoPediatrics Corp.",
            "title": _KIDS_BRONCOS,
            "status": "staged",
            "source": "google_news_rss",
        }
    )


def test_kids_ticker_requires_company_or_symbol():
    import daily_news_desk as desk

    assert desk._blob_mentions_ticker(
        "OrthoPediatrics reports Q2 results",
        "",
        "KIDS",
        "OrthoPediatrics Corp.",
    )
    assert desk._blob_mentions_ticker(
        "OrthoPediatrics (KIDS) files 8-K",
        "",
        "KIDS",
        "OrthoPediatrics Corp.",
    )
    assert desk._blob_mentions_ticker(
        "Analyst initiates $KIDS at overweight",
        "",
        "KIDS",
        "",
    )
    assert not desk._blob_mentions_ticker(
        "How to get kids into science class",
        "",
        "KIDS",
        "OrthoPediatrics Corp.",
    )


def test_infer_ticker_skips_english_kids(monkeypatch):
    import daily_news_desk as desk

    monkeypatch.setattr(
        desk,
        "_company_map",
        lambda: {"KIDS": "OrthoPediatrics Corp.", "CRDL": "Cardiol Therapeutics"},
    )
    assert desk._infer_ticker_from_text(_KIDS_BRONCOS) is None
    assert (
        desk._infer_ticker_from_text("OrthoPediatrics Corp. announces FDA clearance")
        == "KIDS"
    )
    assert desk._infer_ticker_from_text("Cardiol (CRDL) posts cash runway update") == "CRDL"


def test_fetch_company_news_kids_query_omits_english_word(monkeypatch):
    import daily_news_desk as desk

    captured: list[str] = []

    def fake_rss(query: str, max_items: int = 10):
        captured.append(query)
        return [
            {"title": _KIDS_BRONCOS, "summary": "elementary schools football"},
            {
                "title": "OrthoPediatrics Corp. announces ApiFix update",
                "summary": "NASDAQ: KIDS",
            },
        ]

    monkeypatch.setattr("press_release_fetch._fetch_google_news_rss", fake_rss)
    rows = desk._fetch_company_news("KIDS", "OrthoPediatrics Corp.")
    assert captured
    q = captured[0]
    assert "when:1d" in q
    assert 'OR "KIDS"' not in q
    titles = [r["title"] for r in rows]
    assert any("OrthoPediatrics" in t for t in titles)
    assert not any("Broncos" in t for t in titles)


def test_build_highlights_drops_ungrounded_kids():
    import daily_news_desk as desk

    items = [
        {
            "id": "bad",
            "status": "staged",
            "ticker": "KIDS",
            "company": "OrthoPediatrics Corp.",
            "title": _KIDS_BRONCOS,
            "eis_score": 2.0,
            "source": "google_news_rss",
        },
        {
            "id": "ok",
            "status": "staged",
            "ticker": "CRDL",
            "title": "Cardiol reports cash runway into 2028",
            "eis_score": 1.0,
        },
    ]
    out = desk._build_highlights(items)
    ids = [x["id"] for x in out]
    assert "ok" in ids
    assert "bad" not in ids
