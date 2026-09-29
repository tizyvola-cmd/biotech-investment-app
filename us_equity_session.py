"""
US equity session helpers (NYSE/NASDAQ) — America/New_York.

Used by live-price writers to freeze Prezzo Corrente / Var. Giorn. %
outside regular trading hours (and on weekends / NYSE holidays).
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

NY_TZ = ZoneInfo("America/New_York")

# Keep in sync with scripts/daily_market_refresh.py NYSE_HOLIDAYS_*
NYSE_HOLIDAYS_2026 = {
    dt.date(2026, 1, 1),
    dt.date(2026, 1, 19),
    dt.date(2026, 2, 16),
    dt.date(2026, 4, 3),
    dt.date(2026, 5, 25),
    dt.date(2026, 6, 19),
    dt.date(2026, 7, 3),
    dt.date(2026, 9, 7),
    dt.date(2026, 11, 26),
    dt.date(2026, 12, 25),
}

NYSE_HOLIDAYS_2027 = {
    dt.date(2027, 1, 1),
    dt.date(2027, 1, 18),
    dt.date(2027, 2, 15),
    dt.date(2027, 3, 26),
    dt.date(2027, 5, 31),
    dt.date(2027, 6, 18),
    dt.date(2027, 7, 5),
    dt.date(2027, 9, 6),
    dt.date(2027, 11, 25),
    dt.date(2027, 12, 24),
}

NYSE_HOLIDAYS = NYSE_HOLIDAYS_2026 | NYSE_HOLIDAYS_2027

# Regular session: 09:30 inclusive → 16:00 exclusive (ET)
_RTH_OPEN = dt.time(9, 30)
_RTH_CLOSE = dt.time(16, 0)


def ny_now(ref: dt.datetime | None = None) -> dt.datetime:
    if ref is None:
        return dt.datetime.now(tz=NY_TZ)
    if ref.tzinfo is None:
        return ref.replace(tzinfo=dt.timezone.utc).astimezone(NY_TZ)
    return ref.astimezone(NY_TZ)


def is_nyse_trading_day(day: dt.date | None = None) -> tuple[bool, str]:
    """Calendar NYSE session day (Mon–Fri, not holiday) in America/New_York."""
    d = day if day is not None else ny_now().date()
    if d.weekday() >= 5:
        return False, f"weekend ({d:%A})"
    if d in NYSE_HOLIDAYS:
        return False, f"NYSE holiday ({d})"
    return True, "trading day"


def is_us_equity_regular_session(ref: dt.datetime | None = None) -> tuple[bool, str]:
    """
    True only during NYSE regular trading hours (09:30–16:00 ET)
    on a trading day.
    """
    now = ny_now(ref)
    ok, reason = is_nyse_trading_day(now.date())
    if not ok:
        return False, reason
    wall = dt.time(now.hour, now.minute, now.second)
    if wall < _RTH_OPEN:
        return False, "pre-market"
    if wall >= _RTH_CLOSE:
        return False, "after regular close"
    return True, "RTH"


def should_write_live_prices(
    *,
    force: bool = False,
    ref: dt.datetime | None = None,
) -> tuple[bool, str]:
    """
    Whether refresh_live_signals may overwrite Prezzo Corrente / Var. Giorn. %.

    - During NYSE RTH → True (``RTH``) — write live quotes.
    - Outside RTH → True (``settled-close (…)``) — write last regular
      session close so mid-day prints cannot freeze overnight
      (SRPT/HAE 2026-08-12: sheet stuck at −1.21% / −0.27% while EOD
      was +0.9% / +4.7%).
    - ``force=True`` → True (``force=True``).

    Callers should pass the reason into price-mode selection: live ticks
    only on ``RTH`` / ``force``; otherwise prefer completed daily bars.
    """
    if force:
        return True, "force=True"
    rth, reason = is_us_equity_regular_session(ref)
    if rth:
        return True, "RTH"
    return True, f"settled-close ({reason})"


def live_price_write_mode(
    session_reason: str,
) -> str:
    """``live`` = intraday quote; ``settled`` = last completed daily close."""
    if session_reason in ("RTH", "force=True") or session_reason.startswith("force"):
        return "live"
    return "settled"


def last_regular_session_close(
    ref: dt.datetime | None = None,
) -> dt.datetime:
    """
    Timestamp of the most recent NYSE regular close (16:00 America/New_York).

    Used to stamp Prezzo / Var. Giorn. after hours so the UI shows
    «chiusura ~22:00 Roma» instead of a mid-day freeze (e.g. 16:14 CEST).
    """
    now = ny_now(ref)
    d = now.date()
    trading, _ = is_nyse_trading_day(d)
    wall = dt.time(now.hour, now.minute, now.second)
    if trading and wall >= _RTH_CLOSE:
        close_day = d
    else:
        close_day = d - dt.timedelta(days=1)
        for _ in range(12):
            ok, _ = is_nyse_trading_day(close_day)
            if ok:
                break
            close_day -= dt.timedelta(days=1)
    return dt.datetime.combine(close_day, _RTH_CLOSE, tzinfo=NY_TZ)
