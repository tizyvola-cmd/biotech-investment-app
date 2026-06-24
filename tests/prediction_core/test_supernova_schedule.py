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
