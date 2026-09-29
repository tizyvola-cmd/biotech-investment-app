"""Top News must not wipe a good cache when press/8-K fetch returns empty."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


def _rome_today_iso() -> str:
    return datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()


def test_build_top_news_keeps_previous_on_empty_fetch(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()

    prev_row = {
        "id": "crdl1",
        "ticker": "CRDL",
        "title": "Cardiol press release",
        "link": "https://example.com/crdl",
        "eis_score": 1.5,
        "source_kind": "press",
        "published_at": today,
        "event_date": today,
        "found_at": f"{today}T10:00:00+02:00",
    }
    desk._write(
        {
            "top_news": [prev_row],
            "top_news_tickers": ["CRDL"],
            "top_news_hour_bucket": "x",
            "items": [],
            "highlights": [],
            "user_analyses": [],
        }
    )

    monkeypatch.setattr(desk, "_company_map", lambda: {"CRDL": "Cardiol"})
    monkeypatch.setattr(desk, "_press_rows_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "_recent_8k_digests_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "cache_staged_daily_news_to_clinical", lambda **k: None)

    out = desk.build_top_news(["CRDL"], force=True)
    assert out.get("kept_previous_top") is True
    assert out.get("top_count") == 1
    top = out.get("top_news") or []
    assert len(top) == 1
    assert top[0].get("ticker") == "CRDL"
    assert top[0].get("link")


def test_build_top_news_reuses_staged_when_fetch_and_prev_empty(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    desk._write(
        {
            "top_news": [],
            "top_news_tickers": ["CRDL"],
            "items": [
                {
                    "id": "staged1",
                    "ticker": "CRDL",
                    "title": "Cardiol staged press",
                    "link": "https://example.com/crdl-staged",
                    "status": "staged",
                    "eis_score": 1.2,
                    "published_at": today,
                    "event_date": today,
                    "found_at": f"{today}T09:00:00+02:00",
                }
            ],
            "highlights": [],
            "user_analyses": [],
        }
    )
    monkeypatch.setattr(desk, "_company_map", lambda: {"CRDL": "Cardiol"})
    monkeypatch.setattr(desk, "_press_rows_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "_recent_8k_digests_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "cache_staged_daily_news_to_clinical", lambda **k: None)

    out = desk.build_top_news(["CRDL"], force=True)
    assert out.get("kept_previous_top") is True
    assert out.get("top_count") == 1
    assert (out.get("top_news") or [])[0].get("id") == "staged1"


def test_build_top_news_merges_fresh_with_previous(monkeypatch, tmp_path):
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
                    "eis_score": 0.5,
                    "published_at": today,
                    "event_date": today,
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
    assert out.get("kept_previous_top") is True
    assert out.get("top_count") == 2
    ids = {r.get("id") for r in (out.get("top_news") or [])}
    assert ids == {"old", "new1"}
