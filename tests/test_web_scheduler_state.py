"""Scheduler cursors survive a process restart."""

from datetime import date

import supernova_web_scheduler as sch


def test_scheduler_state_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(sch, "_STATE_PATH", tmp_path / "web_scheduler_state.json")
    prev_week = sch._last_8k_dossier_week
    prev_morning = sch._last_morning_date
    try:
        sch._last_8k_dossier_week = "2026-W39"
        sch._last_morning_date = date(2026, 9, 23)
        sch._last_trends_slot = "2026-09-23O1000"
        sch.save_scheduler_state()
        sch._last_8k_dossier_week = None
        sch._last_morning_date = None
        sch._last_trends_slot = None
        sch.load_scheduler_state()
        assert sch._last_8k_dossier_week == "2026-W39"
        assert sch._last_morning_date == date(2026, 9, 23)
        assert sch._last_trends_slot == "2026-09-23O1000"
    finally:
        sch._last_8k_dossier_week = prev_week
        sch._last_morning_date = prev_morning
        sch._last_trends_slot = None
