"""Dismissed/migrated Daily News stays off the desk; same-day event family is one row."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo


def _rome_today_iso() -> str:
    return datetime.now(ZoneInfo("Europe/Rome")).date().isoformat()


def test_story_cluster_collapses_same_family():
    import daily_news_desk as desk

    today = _rome_today_iso()
    a = desk._story_cluster_key(
        ticker="CRDL",
        title="Cardiol Therapeutics (CRDL) taps warrants for pivotal heart trial - Stock Titan",
        day=today,
    )
    b = desk._story_cluster_key(
        ticker="CRDL",
        title="Cardiol Therapeutics (CRDL) Raises $7M via Warrants, Extends Run - gurufocus.com",
        day=today,
    )
    assert a == b
    assert a.endswith("|financing")

    cash = desk._story_cluster_key(
        ticker="CRDL",
        title="Cardiol Therapeutics (Nasdaq: CRDL) opens path to raise cash for heart drug trials",
        day=today,
    )
    assert cash == a

    u1 = desk._story_cluster_key(
        ticker="BNTX",
        title="Berenberg Bank Maintains BioNTech With Buy Rating, Raises Target Price to $140",
        day=today,
    )
    u2 = desk._story_cluster_key(
        ticker="BNTX",
        title="BioNTech SE: UBS maintains a Buy rating",
        day=today,
    )
    assert u1 == u2
    assert u1.endswith("|analyst")


def test_story_cluster_keeps_distinct_families():
    import daily_news_desk as desk

    today = _rome_today_iso()
    fin = desk._story_cluster_key(
        ticker="CRDL",
        title="Cardiol raises $7M via warrants",
        day=today,
    )
    clin = desk._story_cluster_key(
        ticker="CRDL",
        title="Cardiol reports Phase 3 topline readout in pericarditis",
        day=today,
    )
    assert fin != clin


def test_dismissed_headline_does_not_return_on_top_rebuild(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    row = {
        "id": "crdl1",
        "ticker": "CRDL",
        "title": "Cardiol Therapeutics taps warrants for pivotal heart trial - Stock Titan",
        "link": "https://example.com/crdl-warrants-a",
        "eis_score": 1.5,
        "source_kind": "press",
        "published_at": today,
        "event_date": today,
    }
    desk._write({"top_news": [row], "items": [], "highlights": [], "user_analyses": []})
    out = desk.dismiss_daily_news_item(item_id="crdl1")
    assert out.get("dismissed") >= 1
    assert not (out.get("top_news") or [])

    twin = {
        **row,
        "id": "crdl2",
        "title": "Cardiol Therapeutics Raises $7M via Warrants, Extends Run - gurufocus",
        "link": "https://other.com/crdl-warrants-b",
    }
    monkeypatch.setattr(desk, "_company_map", lambda: {"CRDL": "Cardiol"})
    monkeypatch.setattr(desk, "_press_rows_for_ticker", lambda *a, **k: [twin])
    monkeypatch.setattr(desk, "_recent_8k_digests_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "cache_staged_daily_news_to_clinical", lambda **k: None)

    rebuilt = desk.build_top_news(["CRDL"], force=True)
    titles = [str(r.get("title") or "") for r in (rebuilt.get("top_news") or [])]
    assert titles == []


def test_build_top_news_dedupes_same_family(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    fresh = [
        {
            "id": "a1",
            "ticker": "BNTX",
            "title": "Berenberg Bank Maintains BioNTech With Buy Rating",
            "link": "https://example.com/bntx-berenberg",
            "eis_score": 0.4,
            "published_at": today,
            "event_date": today,
        },
        {
            "id": "a2",
            "ticker": "BNTX",
            "title": "BioNTech SE: UBS maintains a Buy rating",
            "link": "https://example.com/bntx-ubs",
            "eis_score": 0.6,
            "published_at": today,
            "event_date": today,
        },
        {
            "id": "a3",
            "ticker": "BNTX",
            "title": "BioNTech SE: Jefferies keeps its Buy rating",
            "link": "https://example.com/bntx-jeff",
            "eis_score": 0.2,
            "published_at": today,
            "event_date": today,
        },
    ]
    desk._write({"top_news": [], "items": [], "highlights": [], "user_analyses": []})
    monkeypatch.setattr(desk, "_company_map", lambda: {"BNTX": "BioNTech"})
    monkeypatch.setattr(desk, "_press_rows_for_ticker", lambda *a, **k: list(fresh))
    monkeypatch.setattr(desk, "_recent_8k_digests_for_ticker", lambda *a, **k: [])
    monkeypatch.setattr(desk, "cache_staged_daily_news_to_clinical", lambda **k: None)

    out = desk.build_top_news(["BNTX"], force=True)
    top = out.get("top_news") or []
    assert len(top) == 1
    assert "UBS" in str(top[0].get("title") or "")


def test_load_daily_news_promotes_scored_staged_into_top(monkeypatch, tmp_path):
    import daily_news_desk as desk

    cache_path = tmp_path / "daily_news_desk.json"
    monkeypatch.setattr(desk, "_PATH", cache_path)
    today = _rome_today_iso()
    weak = {
        "id": "weak",
        "ticker": "CRDL",
        "title": "Cardiol Therapeutics (Nasdaq: CRDL) opens path to raise cash for heart drug trials",
        "link": "https://example.com/crdl-f10",
        "eis_score": 0.0,
        "financial_score": 0.0,
        "source_kind": "press",
        "published_at": today,
        "event_date": today,
        "status": "staged",
    }
    strong = {
        "id": "strong",
        "ticker": "CRDL",
        "title": "Cash runway into 2028 as Cardiol Therapeutics taps warrants",
        "link": "https://example.com/crdl-runway",
        "eis_score": 1.0,
        "financial_score": 1.0,
        "source_kind": "press",
        "published_at": today,
        "event_date": today,
        "status": "staged",
    }
    desk._write(
        {
            "top_news": [weak],
            "top_news_tickers": ["CRDL"],
            "items": [weak, strong],
            "highlights": [],
            "user_analyses": [],
            "rome_date": today,
        }
    )
    out = desk.load_daily_news()
    top = out.get("top_news") or []
    assert len(top) == 1
    assert top[0]["id"] == "strong"
    assert abs(float(top[0].get("financial_score") or 0)) >= 1.0
