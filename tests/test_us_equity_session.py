"""NYSE session gate for live price writes."""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from refresh_live_signals import apply_metrics_to_snapshot
from us_equity_session import (
    is_nyse_trading_day,
    is_us_equity_regular_session,
    should_write_live_prices,
)

NY = ZoneInfo("America/New_York")


def _ny(y, m, d, hh, mm=0) -> dt.datetime:
    return dt.datetime(y, m, d, hh, mm, tzinfo=NY)


def test_weekend_not_trading_day():
    ok, reason = is_nyse_trading_day(dt.date(2026, 7, 18))  # Saturday
    assert ok is False
    assert "weekend" in reason


def test_weekday_trading_day():
    ok, reason = is_nyse_trading_day(dt.date(2026, 7, 20))  # Monday
    assert ok is True
    assert reason == "trading day"


def test_holiday_not_trading_day():
    ok, reason = is_nyse_trading_day(dt.date(2026, 7, 3))
    assert ok is False
    assert "holiday" in reason


def test_rth_midday():
    ok, reason = is_us_equity_regular_session(_ny(2026, 7, 20, 11, 0))
    assert ok is True
    assert reason == "RTH"


def test_premarket_writes_settled_close():
    ok, reason = should_write_live_prices(ref=_ny(2026, 7, 20, 8, 0))
    assert ok is True
    assert reason.startswith("settled-close")
    assert "pre-market" in reason


def test_after_close_writes_settled_close():
    ok, reason = should_write_live_prices(ref=_ny(2026, 7, 20, 16, 0))
    assert ok is True
    assert reason.startswith("settled-close")
    assert "after regular close" in reason


def test_saturday_writes_settled_close():
    ok, reason = should_write_live_prices(ref=_ny(2026, 7, 18, 12, 0))
    assert ok is True
    assert "weekend" in reason
    assert reason.startswith("settled-close")


def test_force_overrides_weekend():
    ok, reason = should_write_live_prices(force=True, ref=_ny(2026, 7, 18, 12, 0))
    assert ok is True
    assert reason == "force=True"


def test_live_price_write_mode():
    from us_equity_session import live_price_write_mode

    assert live_price_write_mode("RTH") == "live"
    assert live_price_write_mode("force=True") == "live"
    assert live_price_write_mode("settled-close (after regular close)") == "settled"
    assert live_price_write_mode("settled-close (pre-market)") == "settled"


def test_last_regular_session_close_after_hours():
    from us_equity_session import last_regular_session_close

    # Tue 2026-07-21 08:00 ET pre-market → Mon 2026-07-20 16:00 ET close
    close = last_regular_session_close(_ny(2026, 7, 21, 8, 0))
    assert close.year == 2026 and close.month == 7 and close.day == 20
    assert close.hour == 16 and close.minute == 0


def test_last_regular_session_close_same_day_after_bell():
    from us_equity_session import last_regular_session_close

    close = last_regular_session_close(_ny(2026, 7, 20, 17, 30))
    assert close.day == 20
    assert close.hour == 16


def test_apply_metrics_skips_prices_when_frozen():
    snap = {
        "columns": [
            "Ticker",
            "Prezzo Corrente ($)",
            "Var. Giorn. %",
            "Prezzo Apertura ($)",
        ],
        "rows": [
            {
                "Ticker": "TEST",
                "Prezzo Corrente ($)": 10.0,
                "Var. Giorn. %": 1.5,
                "Prezzo Apertura ($)": 9.8,
            }
        ],
    }
    metrics = {
        "TEST": {
            "slope≈5g": 0.1,
            "slope≈20g": 0.2,
            "slope≈45g": 0.3,
            "run_up_30d": 5.0,
            "rsi_14": 50.0,
            "vol_ratio": 1.0,
            "affid_live": 70,
            "affid_live_pct": 0.7,
            "pred5_live": 2.0,
            "direction_live": "up",
            "updated_at": "2026-07-20",
            "current_price": 12.0,
            "prev_close": 10.0,
            "session_open": 11.0,
            "adv_shares_20d": 200_000,
            "low_liq_noise": False,
            "low_liq_reason": None,
        }
    }
    out = apply_metrics_to_snapshot(snap, metrics, update_prices=False)
    row = out["rows"][0]
    assert row["Prezzo Corrente ($)"] == 10.0
    assert row["Var. Giorn. %"] == 1.5
    assert row["Prezzo Apertura ($)"] == 9.8
    assert row["slope≈5g"] == 0.1
    assert row["direction_live"] == "up"

    out2 = apply_metrics_to_snapshot(snap, metrics, update_prices=True)
    row2 = out2["rows"][0]
    assert row2["Prezzo Corrente ($)"] == 12.0
    assert row2["Var. Giorn. %"] == 20.0
