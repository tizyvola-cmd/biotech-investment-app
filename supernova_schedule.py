"""
Timezone-aware refresh windows for the web host scheduler (``Europe/Rome`` default).

* **Hourly financial** — Lun–Ven, slot ogni ora da ``15:30`` a ``21:30`` (fine ``22:00``).
* **Morning research** — Lun–Ven, una volta al giorno a ``07:00`` (CD + IPO + hype volume).
* **SDS cohort refresh** — Lun–Ven, una volta al giorno a ``09:00`` (ricalcolo completo coorte Supernova).
* **EIS / clinical feed** — Lun–Ven, una volta al giorno a ``10:00`` (arricchimento feed + rebuild calibrazione EIS).
* **Model Lab accuracy** — Lun–Ven, una volta al giorno a ``16:30`` (RA Calibration + SDS Accuracy + EIS Magnitude snapshots).
* **Saturday WeeklyFull** — Sabato, una volta al giorno nella finestra ``at``–``window_end`` (default 07:00–14:00).
* **Google Trends** — giorni NYSE aperti: 3×/giorno (10:00, 16:00, 21:00 Rome);
  weekend / festivi NYSE: 11:30 e 17:00. (Google Trends è ~giornaliero; niente poll orario.)
"""
from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

# Fixed Trends poll times (Rome). Baseline Trends is daily — avoid hourly spam.
_TRENDS_OPEN_SLOTS: tuple[dt.time, ...] = (dt.time(10, 0), dt.time(16, 0), dt.time(21, 0))
_TRENDS_CLOSED_SLOTS: tuple[dt.time, ...] = (dt.time(11, 30), dt.time(17, 0))

def parse_hhmm(value: str, *, default: dt.time) -> dt.time:
    raw = (value or "").strip()
    m = _TIME_RE.match(raw)
    if not m:
        return default
    hour, minute = int(m.group(1)), int(m.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return default
    return dt.time(hour, minute)


def rome_now(*, tz_name: str = "Europe/Rome") -> dt.datetime:
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Europe/Rome")
    return dt.datetime.now(tz)


def is_weekday(d: dt.date) -> bool:
    return d.weekday() < 5


def current_hourly_financial_slot(
    now: dt.datetime,
    *,
    start: dt.time,
    end: dt.time,
) -> int | None:
    """
    Slot index for hourly financial refresh (0 = first run at ``start``).

    Returns ``None`` outside ``[start, end)`` or on invalid slot.
    Example: start 15:30, end 22:00 → slots 0..6 at 15:30 … 21:30.
    """
    t = now.time()
    if t < start or t >= end:
        return None
    start_m = start.hour * 60 + start.minute
    end_m = end.hour * 60 + end.minute
    now_m = t.hour * 60 + t.minute
    delta = now_m - start_m
    if delta < 0:
        return None
    slot = delta // 60
    slot_start_m = start_m + slot * 60
    if slot_start_m >= end_m:
        return None
    return int(slot)


def should_run_hourly_financial(
    now: dt.datetime,
    *,
    start: dt.time,
    end: dt.time,
    last_slot: int | None,
    last_date: dt.date | None,
    grace_minutes: int = 12,
) -> bool:
    """True once per slot per calendar day (within ``grace_minutes`` after slot start)."""
    if not is_weekday(now.date()):
        return False
    slot = current_hourly_financial_slot(now, start=start, end=end)
    if slot is None:
        return False
    if last_date == now.date() and last_slot == slot:
        return False
    start_m = start.hour * 60 + start.minute
    slot_start_m = start_m + slot * 60
    now_m = now.hour * 60 + now.minute
    if now_m < slot_start_m or now_m > slot_start_m + grace_minutes:
        return False
    return True


def should_run_morning_refresh(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    grace_minutes: int = 10,
) -> bool:
    """True once per weekday when clock is within ``grace_minutes`` after ``at``."""
    return should_run_daily_at(
        now, at=at, last_date=last_date, grace_minutes=grace_minutes
    )


def should_run_daily_at(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    grace_minutes: int = 10,
) -> bool:
    """True once per weekday when clock is within ``grace_minutes`` after ``at``."""
    if not is_weekday(now.date()):
        return False
    if last_date == now.date():
        return False
    target_m = at.hour * 60 + at.minute
    now_m = now.hour * 60 + now.minute
    return target_m <= now_m <= target_m + grace_minutes


def should_run_sds_refresh(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    grace_minutes: int = 10,
) -> bool:
    """True once per weekday for scheduled full SDS cohort refresh."""
    return should_run_daily_at(
        now, at=at, last_date=last_date, grace_minutes=grace_minutes
    )


def should_run_eis_refresh(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    grace_minutes: int = 10,
) -> bool:
    """True once per weekday for scheduled EIS / clinical feed refresh."""
    return should_run_daily_at(
        now, at=at, last_date=last_date, grace_minutes=grace_minutes
    )


def should_run_model_lab_refresh(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    grace_minutes: int = 10,
) -> bool:
    """True once per weekday for scheduled RA Calibration + SDS Accuracy refresh."""
    return should_run_daily_at(
        now, at=at, last_date=last_date, grace_minutes=grace_minutes
    )


def is_saturday(d: dt.date) -> bool:
    return d.weekday() == 5


def is_trends_market_open_day(d: dt.date) -> bool:
    """Rome civil date: weekday and not a NYSE holiday (early-warning poll cadence)."""
    if d.weekday() >= 5:
        return False
    from us_equity_session import NYSE_HOLIDAYS

    return d not in NYSE_HOLIDAYS


def trends_refresh_slot_id(
    now: dt.datetime,
    *,
    grace_minutes: int = 20,
    open_slots: tuple[dt.time, ...] | None = None,
    closed_slots: tuple[dt.time, ...] | None = None,
) -> str | None:
    """
    Slot id if ``now`` is inside a Trends poll window, else ``None``.

    Open NYSE days: fixed slots (default 10:00 / 16:00 / 21:00 Rome) — Google's
    daily index does not justify hourly polling.
    Closed days (weekend / NYSE holiday): 11:30 and 17:00.
    """
    if is_trends_market_open_day(now.date()):
        slots = open_slots or _TRENDS_OPEN_SLOTS
        prefix = "O"
    else:
        slots = closed_slots or _TRENDS_CLOSED_SLOTS
        prefix = "C"
    now_m = now.hour * 60 + now.minute
    grace = max(1, int(grace_minutes))
    for slot in slots:
        target = slot.hour * 60 + slot.minute
        if target <= now_m <= target + grace:
            return f"{now.date().isoformat()}{prefix}{slot.hour:02d}{slot.minute:02d}"
    return None


def should_run_trends_refresh(
    now: dt.datetime,
    *,
    last_slot: str | None,
    grace_minutes: int = 20,
) -> bool:
    """True once per Trends slot (3× open days, 2× when closed)."""
    slot = trends_refresh_slot_id(now, grace_minutes=grace_minutes)
    if slot is None:
        return False
    return slot != last_slot


def should_run_saturday_weekly_full(
    now: dt.datetime,
    *,
    at: dt.time,
    last_date: dt.date | None,
    window_end: dt.time | None = None,
) -> bool:
    """
    True once per Saturday when clock is in ``[at, window_end)``.

    Default window 07:00–14:00 (allineato all'autostart desktop sabato mattina).
    Se il servizio riparte in ritardo, il run parte al primo poll nella finestra.
    """
    if not is_saturday(now.date()):
        return False
    if last_date == now.date():
        return False
    end = window_end or dt.time(14, 0)
    target_m = at.hour * 60 + at.minute
    end_m = end.hour * 60 + end.minute
    now_m = now.hour * 60 + now.minute
    return target_m <= now_m < end_m


def iso_week_key(d: dt.date) -> str:
    """ISO week key ``YYYY-Www`` (Monday-based)."""
    iso = d.isocalendar()
    return f"{iso.year:04d}-W{iso.week:02d}"


def should_run_guidance_calendar_weekly(
    now: dt.datetime,
    *,
    last_week: str | None,
    at: dt.time | None = None,
) -> bool:
    """True once per ISO week after Monday ``at`` (default 10:30 Rome).

    Primary: Monday ≥ 10:30.
    Catch-up: Tue–Sun if this week's run was missed (server down on Monday).
    """
    target = at or dt.time(10, 30)
    week = iso_week_key(now.date())
    if last_week == week:
        return False
    # Monday before window → wait
    if now.weekday() == 0:
        return (now.hour, now.minute) >= (target.hour, target.minute)
    # Tue–Sun: catch-up so the rolling 6-month Calendar still refreshes
    return now.weekday() >= 1


def should_run_8k_dossier_weekly(
    now: dt.datetime,
    *,
    last_week: str | None,
    at: dt.time | None = None,
) -> bool:
    """True once per Wednesday after ``at`` (default 07:15 Rome) for 8-K dossier refresh."""
    target = at or dt.time(7, 15)
    if now.weekday() != 2:  # Wednesday
        return False
    week = iso_week_key(now.date())
    if last_week == week:
        return False
    return (now.hour, now.minute) >= (target.hour, target.minute)


__all__ = [
    "current_hourly_financial_slot",
    "is_weekday",
    "parse_hhmm",
    "rome_now",
    "should_run_hourly_financial",
    "should_run_daily_at",
    "should_run_morning_refresh",
    "should_run_sds_refresh",
    "should_run_eis_refresh",
    "should_run_model_lab_refresh",
    "is_saturday",
    "should_run_saturday_weekly_full",
    "is_trends_market_open_day",
    "trends_refresh_slot_id",
    "should_run_trends_refresh",
    "iso_week_key",
    "should_run_guidance_calendar_weekly",
    "should_run_8k_dossier_weekly",
]
