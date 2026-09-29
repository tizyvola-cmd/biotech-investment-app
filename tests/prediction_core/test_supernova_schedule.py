"""Tests for supernova_schedule (timezone windows)."""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import supernova_schedule as sched


def _rome(y: int, m: int, d: int, hh: int, mm: int) -> dt.datetime:
    return dt.datetime(y, m, d, hh, mm, tzinfo=ZoneInfo("Europe/Rome"))


def test_hourly_slots_1530_to_2200():
    start = dt.time(15, 30)
    end = dt.time(22, 0)
    assert sched.current_hourly_financial_slot(_rome(2026, 6, 8, 15, 29), start=start, end=end) is None
    assert sched.current_hourly_financial_slot(_rome(2026, 6, 8, 15, 30), start=start, end=end) == 0
    assert sched.current_hourly_financial_slot(_rome(2026, 6, 8, 16, 30), start=start, end=end) == 1
    assert sched.current_hourly_financial_slot(_rome(2026, 6, 8, 21, 30), start=start, end=end) == 6
    assert sched.current_hourly_financial_slot(_rome(2026, 6, 8, 22, 0), start=start, end=end) is None


def test_should_run_hourly_once_per_slot():
    start = dt.time(15, 30)
    end = dt.time(22, 0)
    t = _rome(2026, 6, 8, 15, 32)
    assert sched.should_run_hourly_financial(
        t, start=start, end=end, last_slot=None, last_date=None
    )
    assert not sched.should_run_hourly_financial(
        t, start=start, end=end, last_slot=0, last_date=t.date()
    )


def test_morning_refresh_weekday_only():
    at = dt.time(7, 0)
    mon = _rome(2026, 6, 8, 7, 5)
    sat = _rome(2026, 6, 6, 7, 5)
    assert sched.should_run_morning_refresh(mon, at=at, last_date=None)
    assert not sched.should_run_morning_refresh(sat, at=at, last_date=None)


def test_sds_refresh_at_0900():
    at = dt.time(9, 0)
    mon = _rome(2026, 6, 8, 9, 3)
    assert sched.should_run_sds_refresh(mon, at=at, last_date=None)
    assert not sched.should_run_sds_refresh(mon, at=at, last_date=mon.date())
    assert not sched.should_run_sds_refresh(_rome(2026, 6, 6, 9, 3), at=at, last_date=None)


def test_parse_hhmm():
    assert sched.parse_hhmm("15:30", default=dt.time(0, 0)) == dt.time(15, 30)
    assert sched.parse_hhmm("bad", default=dt.time(9, 0)) == dt.time(9, 0)


def test_model_lab_refresh_at_1630():
    at = dt.time(16, 30)
    wed = _rome(2026, 6, 10, 16, 32)
    assert sched.should_run_model_lab_refresh(wed, at=at, last_date=None)
    assert not sched.should_run_model_lab_refresh(wed, at=at, last_date=wed.date())
    assert not sched.should_run_model_lab_refresh(_rome(2026, 6, 6, 16, 32), at=at, last_date=None)


def test_trends_thrice_on_open_weekday():
    morn = _rome(2026, 6, 8, 10, 4)
    assert sched.is_trends_market_open_day(morn.date())
    assert sched.should_run_trends_refresh(morn, last_slot=None)
    assert not sched.should_run_trends_refresh(morn, last_slot="2026-06-08O1000")
    mid = _rome(2026, 6, 8, 16, 5)
    assert sched.should_run_trends_refresh(mid, last_slot="2026-06-08O1000")
    eve = _rome(2026, 6, 8, 21, 2)
    assert sched.should_run_trends_refresh(eve, last_slot="2026-06-08O1600")
    # Former hourly slot — no longer a Trends poll.
    old_hourly = _rome(2026, 6, 8, 15, 4)
    assert not sched.should_run_trends_refresh(old_hourly, last_slot=None)
    before = _rome(2026, 6, 8, 8, 5)
    assert not sched.should_run_trends_refresh(before, last_slot=None)
    too_late = _rome(2026, 6, 8, 10, 25)
    assert not sched.should_run_trends_refresh(too_late, last_slot=None)


def test_trends_closed_day_twice():
    sat_morn = _rome(2026, 9, 5, 11, 32)
    sat_aft = _rome(2026, 9, 5, 17, 5)
    sat_idle = _rome(2026, 9, 5, 15, 2)
    assert not sched.is_trends_market_open_day(sat_morn.date())
    assert sched.should_run_trends_refresh(sat_morn, last_slot=None)
    assert not sched.should_run_trends_refresh(sat_morn, last_slot="2026-09-05C1130")
    assert sched.should_run_trends_refresh(sat_aft, last_slot="2026-09-05C1130")
    assert not sched.should_run_trends_refresh(sat_idle, last_slot=None)


def test_trends_nyse_holiday_uses_closed_slots():
    labor = _rome(2026, 9, 7, 11, 35)
    labor_hourly = _rome(2026, 9, 7, 15, 3)
    assert not sched.is_trends_market_open_day(labor.date())
    assert sched.should_run_trends_refresh(labor, last_slot=None)
    assert not sched.should_run_trends_refresh(labor_hourly, last_slot=None)


def test_saturday_weekly_full_window():
    at = dt.time(7, 0)
    end = dt.time(14, 0)
    sat_morning = _rome(2026, 6, 6, 7, 5)  # Saturday 2026-06-06
    fri = _rome(2026, 6, 5, 7, 5)
    sat_afternoon = _rome(2026, 6, 6, 13, 30)
    sat_evening = _rome(2026, 6, 6, 14, 5)
    assert sched.should_run_saturday_weekly_full(
        sat_morning, at=at, last_date=None, window_end=end
    )
    assert sched.should_run_saturday_weekly_full(
        sat_afternoon, at=at, last_date=None, window_end=end
    )
    assert not sched.should_run_saturday_weekly_full(
        fri, at=at, last_date=None, window_end=end
    )
    assert not sched.should_run_saturday_weekly_full(
        sat_evening, at=at, last_date=None, window_end=end
    )
    assert not sched.should_run_saturday_weekly_full(
        sat_morning, at=at, last_date=sat_morning.date(), window_end=end
    )


def test_guidance_calendar_weekly_monday_only():
    at = dt.time(10, 30)
    mon = _rome(2026, 9, 7, 10, 35)  # Monday
    tue = _rome(2026, 9, 8, 10, 35)
    mon_early = _rome(2026, 9, 7, 10, 0)
    week = sched.iso_week_key(mon.date())
    assert week == "2026-W37"
    assert sched.should_run_guidance_calendar_weekly(mon, last_week=None, at=at)
    assert not sched.should_run_guidance_calendar_weekly(mon_early, last_week=None, at=at)
    assert not sched.should_run_guidance_calendar_weekly(mon, last_week=week, at=at)
    # Catch-up Tue if Monday was missed
    assert sched.should_run_guidance_calendar_weekly(tue, last_week=None, at=at)
    assert not sched.should_run_guidance_calendar_weekly(tue, last_week=week, at=at)


def test_8k_dossier_weekly_wednesday_only():
    at = dt.time(7, 15)
    wed = _rome(2026, 9, 16, 7, 20)  # Wednesday
    tue = _rome(2026, 9, 15, 7, 20)
    wed_early = _rome(2026, 9, 16, 7, 0)
    week = sched.iso_week_key(wed.date())
    assert sched.should_run_8k_dossier_weekly(wed, last_week=None, at=at)
    assert not sched.should_run_8k_dossier_weekly(tue, last_week=None, at=at)
    assert not sched.should_run_8k_dossier_weekly(wed_early, last_week=None, at=at)
    assert not sched.should_run_8k_dossier_weekly(wed, last_week=week, at=at)
