"""Tests for Deep Dive historical library (archive at T+8, rehydrate on re-entry)."""
from __future__ import annotations

from datetime import date, timedelta


def test_archive_past_catalyst_moves_out_of_live(tmp_path, monkeypatch):
    import clinical_deep_dive_history as hist

    lib = tmp_path / "clinical_pre_cd_historical_library.json"
    monkeypatch.setattr(hist, "_LIBRARY_PATH", lib)
    today = date(2026, 9, 13)
    old_cd = (today - timedelta(days=10)).isoformat()  # T+10 → archive
    watch_cd = (today - timedelta(days=3)).isoformat()  # T+3 → keep
    future_cd = (today + timedelta(days=20)).isoformat()

    live = [
        {"ticker": "AAA", "nct_id": "NCT1", "cd_date": old_cd, "clinical_events": [{"event_title": "E1"}]},
        {"ticker": "BBB", "nct_id": "NCT2", "cd_date": watch_cd, "clinical_events": []},
        {"ticker": "CCC", "nct_id": "NCT3", "cd_date": future_cd, "clinical_events": []},
        # Past CD but still in keep_tickers (open book) → stay live
        {"ticker": "DDD", "nct_id": "NCT4", "cd_date": old_cd, "clinical_events": [{"event_title": "keep"}]},
    ]
    stay, n = hist.archive_past_catalyst_from_live(
        live, keep_tickers={"DDD"}, today=today
    )
    assert n == 1
    assert {r["ticker"] for r in stay} == {"BBB", "CCC", "DDD"}
    doc = hist.load_library()
    assert doc["count"] == 1
    assert doc["entries"][0]["ticker"] == "AAA"
    assert len(doc["entries"][0]["record"]["clinical_events"]) == 1


def test_rehydrate_on_reentry(tmp_path, monkeypatch):
    import clinical_deep_dive_history as hist

    lib = tmp_path / "clinical_pre_cd_historical_library.json"
    monkeypatch.setattr(hist, "_LIBRARY_PATH", lib)
    hist.upsert_library_entries(
        [
            hist._entry_from_record(
                {
                    "ticker": "CRDL",
                    "nct_id": "NCT999",
                    "cd_date": "2025-01-15",
                    "clinical_events": [
                        {"event_date": "2025-01-10", "event_title": "Old EIS event"}
                    ],
                }
            )
        ]
    )
    prev: dict = {}
    added = hist.rehydrate_historical_into_prev(prev, {"CRDL"})
    assert added == 1
    assert "CRDL|NCT999" in prev
    assert prev["CRDL|NCT999"]["_from_historical_library"] is True
    assert prev["CRDL|NCT999"]["clinical_events"][0]["event_title"] == "Old EIS event"


def test_is_past_catalyst_boundary():
    import clinical_deep_dive_history as hist

    today = date(2026, 9, 13)
    # T+7 inclusive watch → not archived
    assert hist.is_past_catalyst_archived(
        (today - timedelta(days=7)).isoformat(), today=today
    ) is False
    # T+8 → archived
    assert hist.is_past_catalyst_archived(
        (today - timedelta(days=8)).isoformat(), today=today
    ) is True
