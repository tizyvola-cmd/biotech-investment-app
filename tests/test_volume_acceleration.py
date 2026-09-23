"""Synthetic tests for volume acceleration — no Yahoo."""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from volume_acceleration import (
    VolumeAccelConfig,
    build_seasonal_baseline,
    compute_volume_acceleration_score,
    doubling_time_from_beta,
    rolling_log_slope,
    score_ticker_bars,
)


def test_doubling_time_from_beta():
    beta = 0.023104906018664844  # ln(2) / 30
    t = doubling_time_from_beta(beta)
    assert t is not None
    assert abs(t - 30.0) < 0.05
    assert doubling_time_from_beta(0) is None
    assert doubling_time_from_beta(-0.1) is None


def test_rolling_log_slope_recovers_30min_doubling():
    t = [0, 5, 10, 15, 20, 25]
    rvols = [2 ** (x / 30) for x in t]
    beta, r2 = rolling_log_slope(rvols, 5)
    assert r2 > 0.99
    td = doubling_time_from_beta(beta)
    assert td is not None
    assert abs(td - 30.0) < 1.0


def _session_bars(
    day: datetime,
    volumes: list[float],
    close: float = 10.0,
    start_hour: int = 10,
) -> pd.DataFrame:
    rows = []
    for i, vol in enumerate(volumes):
        ts = day.replace(hour=start_hour, minute=0, second=0, microsecond=0) + timedelta(
            minutes=5 * i
        )
        rows.append({"timestamp": pd.Timestamp(ts), "volume": vol, "close": close})
    return pd.DataFrame(rows)


def test_compute_flags_exponential_today_against_flat_baseline():
    cfg = VolumeAccelConfig(
        min_dollar_volume=1.0,
        price_weight=False,
        confirm_buckets=2,
        doubling_time_alert_minutes=30.0,
    )
    hist_parts = []
    base_day = datetime(2026, 8, 10)
    for d in range(8):
        day = base_day + timedelta(days=d)
        if day.weekday() >= 5:
            continue
        hist_parts.append(_session_bars(day, [1000.0] * 10))
    history = pd.concat(hist_parts, ignore_index=True)
    baseline = build_seasonal_baseline(history, lookback_days=20)
    assert not baseline.empty

    today = datetime(2026, 8, 20, 10, 0, 0)
    t = list(range(0, 50, 5))
    vols = [1000.0 * (2 ** (x / 30)) for x in t]
    live = _session_bars(today, vols, close=10.0)
    results = compute_volume_acceleration_score("CRDL", live, baseline, cfg)
    flagged = [r for r in results if r.flagged]
    assert flagged, "exponential RVOL should confirm after 2 buckets"
    last = flagged[-1]
    assert last.doubling_time_minutes is not None
    assert last.doubling_time_minutes <= 35
    assert last.score > 0


def test_score_ticker_bars_splits_history_and_live():
    cfg = VolumeAccelConfig(
        min_dollar_volume=1.0,
        price_weight=False,
        confirm_buckets=1,
    )
    parts = []
    for d in range(5):
        day = datetime(2026, 8, 10) + timedelta(days=d)
        if day.weekday() >= 5:
            continue
        parts.append(_session_bars(day, [800.0] * 8))
    live_day = datetime(2026, 8, 17)
    t = list(range(0, 40, 5))
    vols = [800.0 * (2 ** (x / 25)) for x in t]
    parts.append(_session_bars(live_day, vols, close=12.0))
    bars = pd.concat(parts, ignore_index=True)
    bars["timestamp"] = pd.to_datetime(bars["timestamp"]).dt.tz_localize(
        "America/New_York"
    )
    tz = bars["timestamp"].dt.tz
    result = score_ticker_bars(
        "NRIX",
        bars,
        config=cfg,
        today=datetime(2026, 8, 17, 12, 0, tzinfo=tz),
    )
    assert result is not None
    assert result.flagged is True
    assert result.ticker == "NRIX"
