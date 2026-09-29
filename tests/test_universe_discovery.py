"""Unit tests for Universe Discovery Screener (no live EDGAR calls)."""

from __future__ import annotations

from datetime import date, timedelta

from universe_discovery import (
    _merge_candidate,
    list_calendar_work,
    remove_from_calendar_queue,
    sync_near_catalyst_sim_entries,
    upsert_calendar_queue_from_row,
)


def test_merge_candidate_dedupes_keywords_and_promotes_tier_a() -> None:
    bucket: dict = {}
    hit_b = {
        "cik": "1590560",
        "ticker": "QURE",
        "company_name": "uniQure N.V.",
        "sic": "2834",
        "file_date": "2026-09-02",
        "snippet": "PDUFA date…",
        "source_filing_url": "https://example/a",
        "adsh": "0001",
    }
    hit_a = {
        **hit_b,
        "snippet": "Breakthrough Therapy…",
        "file_date": "2026-09-01",
        "source_filing_url": "https://example/b",
        "adsh": "0002",
    }
    _merge_candidate(bucket, hit_b, keyword="PDUFA", tier="B")
    _merge_candidate(bucket, hit_a, keyword="Breakthrough Therapy", tier="A")
    row = bucket["0001590560"]
    assert row["signal_tier"] == "A"
    assert row["matched_keywords"] == ["PDUFA", "Breakthrough Therapy"]
    assert row["first_seen_at"] == "2026-09-01"
    assert row["source_filing_url"] == "https://example/b"


def test_calendar_queue_upsert_and_list(tmp_path, monkeypatch) -> None:
    import universe_discovery as ud

    monkeypatch.setattr(ud, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(ud, "_CALENDAR_QUEUE_PATH", tmp_path / "discovery_calendar_queue.json")
    monkeypatch.setattr(ud, "_STORE_PATH", tmp_path / "store.json")
    monkeypatch.setattr(ud, "_SNAPSHOT_PATH", tmp_path / "snap.json")
    monkeypatch.setattr(ud, "_DISCOVERY_SIM_ENTRIES_PATH", tmp_path / "disc_sim.json")

    entry = upsert_calendar_queue_from_row(
        {"ticker": "LQDA", "company_name": "Liquidia", "signal_tier": "A"},
        "0001819576",
    )
    assert entry and entry["ticker"] == "LQDA"
    work = list_calendar_work()
    assert len(work) == 1
    assert work[0]["cik10"] == "0001819576"
    remove_from_calendar_queue("0001819576")
    assert list_calendar_work() == []


def test_should_run_universe_discovery_monthly_on_second() -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from universe_discovery import should_run_universe_discovery_monthly

    tz = ZoneInfo("Europe/Rome")
    day2 = datetime(2026, 9, 2, 8, 0, tzinfo=tz)
    day1 = datetime(2026, 9, 1, 8, 0, tzinfo=tz)
    day2_early = datetime(2026, 9, 2, 7, 0, tzinfo=tz)
    assert should_run_universe_discovery_monthly(day2, last_month=None)
    assert not should_run_universe_discovery_monthly(day1, last_month=None)
    assert not should_run_universe_discovery_monthly(day2_early, last_month=None)
    assert not should_run_universe_discovery_monthly(day2, last_month="2026-09")


def test_auto_enqueue_skips_rejected(tmp_path, monkeypatch) -> None:
    import universe_discovery as ud

    monkeypatch.setattr(ud, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(ud, "_CALENDAR_QUEUE_PATH", tmp_path / "discovery_calendar_queue.json")
    monkeypatch.setattr(ud, "_STORE_PATH", tmp_path / "store.json")
    monkeypatch.setattr(ud, "_SNAPSHOT_PATH", tmp_path / "snap.json")
    monkeypatch.setattr(ud, "_DISCOVERY_SIM_ENTRIES_PATH", tmp_path / "disc_sim.json")
    monkeypatch.setattr(ud, "_SCHEDULE_MARKER_PATH", tmp_path / "sched.json")

    queued = ud.auto_enqueue_candidates_to_calendar(
        [
            {
                "ticker": "LQDA",
                "cik": "0001819576",
                "company_name": "Liquidia",
                "status": "new",
            },
            {
                "ticker": "BAD",
                "cik": "0001111111",
                "company_name": "BadCo",
                "status": "reviewed_rejected",
            },
        ]
    )
    assert len(queued) == 1
    assert queued[0]["ticker"] == "LQDA"
    assert any(w["ticker"] == "LQDA" for w in ud.list_calendar_work())


def test_sync_near_catalyst_promotes_within_horizon(tmp_path, monkeypatch) -> None:
    import universe_discovery as ud

    monkeypatch.setattr(ud, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(ud, "_CALENDAR_QUEUE_PATH", tmp_path / "discovery_calendar_queue.json")
    monkeypatch.setattr(ud, "_DISCOVERY_SIM_ENTRIES_PATH", tmp_path / "disc_sim.json")

    upsert_calendar_queue_from_row(
        {"ticker": "SMMT", "company_name": "Summit"},
        "0001599298",
    )
    soon = (date.today() + timedelta(days=12)).isoformat()
    far = (date.today() + timedelta(days=45)).isoformat()
    cal = [
        {
            "ticker": "SMMT",
            "event_type": "PDUFA",
            "date_precision": "exact_date",
            "date_value": soon,
            "raw_snippet": "PDUFA",
            "confidence": "high",
        },
        {
            "ticker": "SMMT",
            "event_type": "PDUFA",
            "date_precision": "exact_date",
            "date_value": far,
            "raw_snippet": "far",
            "confidence": "high",
        },
    ]
    res = sync_near_catalyst_sim_entries(cal, horizon_days=20)
    assert res["entries"] == 1
    doc = (tmp_path / "disc_sim.json").read_text(encoding="utf-8")
    assert "SMMT" in doc
    assert soon in doc
