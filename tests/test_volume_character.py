"""Synthetic tests for Volume Character Classifier — no Yahoo."""
from __future__ import annotations

from volume_character import (
    TAG_AMBIGUOUS,
    TAG_ANTICIPATORY_ACCUMULATION,
    TAG_ANTICIPATORY_DISTRIBUTION,
    TAG_QUIET_ACCUMULATION,
    TAG_REACTIVE,
    classify_bar_at,
    classify_peak_anomaly,
    clv_at,
    rvol_at,
    udvr_ending_at,
)


def _bar(day: str, close: float, volume: float, *, high: float | None = None, low: float | None = None):
    h = high if high is not None else close * 1.01
    lo = low if low is not None else close * 0.99
    return {
        "date": day,
        "open": close,
        "high": h,
        "low": lo,
        "close": close,
        "volume": volume,
    }


def _flat_history(n: int = 25, vol: float = 100_000.0, close: float = 10.0) -> list[dict]:
    """n sessions ending 2026-09-02."""
    # Build dates going backward from 2026-09-02 skipping weekends roughly via sequential ISO days
    # Use simple weekday sequence in September/August 2026.
    days = [
        "2026-07-29",
        "2026-07-30",
        "2026-07-31",
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-17",
        "2026-08-18",
        "2026-08-19",
        "2026-08-20",
        "2026-08-21",
        "2026-08-24",
        "2026-08-25",
        "2026-08-26",
        "2026-08-27",
        "2026-08-28",
        "2026-08-31",
        "2026-09-01",
        "2026-09-02",
    ]
    assert len(days) >= n
    return [_bar(d, close, vol) for d in days[-n:]]


def test_rvol_uses_median_prior_only():
    bars = _flat_history(22, vol=100_000)
    # Inject an old spike that must not inflate the median baseline much
    bars[5]["volume"] = 5_000_000
    bars[-1]["volume"] = 400_000  # 4x typical
    r = rvol_at(bars, len(bars) - 1)
    assert r is not None
    assert 3.5 < r < 4.5  # median stays near 100k


def test_clv_accumulation_and_distribution():
    assert clv_at({"high": 10, "low": 8, "close": 9.9}) > 0.5
    assert clv_at({"high": 10, "low": 8, "close": 8.1}) < -0.5


def test_udvr_accumulation_bias():
    bars = _flat_history(15, vol=100_000, close=10.0)
    # Last 10 sessions: up days with high volume
    for i in range(len(bars) - 10, len(bars)):
        bars[i]["close"] = 10 + (i - (len(bars) - 10)) * 0.2
        bars[i]["volume"] = 200_000
        bars[i]["high"] = bars[i]["close"] + 0.05
        bars[i]["low"] = bars[i]["close"] - 0.05
    # One down day with tiny volume
    bars[-3]["close"] = bars[-4]["close"] - 0.05
    bars[-3]["volume"] = 10_000
    u = udvr_ending_at(bars, len(bars) - 1)
    assert u is not None and u > 1.5


def test_anticipatory_accumulation():
    bars = _flat_history(25, vol=100_000, close=10.0)
    for i in range(len(bars) - 10, len(bars)):
        bars[i]["close"] = 10 + (i - (len(bars) - 10)) * 0.15
        bars[i]["volume"] = 150_000
        bars[i]["high"] = bars[i]["close"] + 0.05
        bars[i]["low"] = bars[i]["close"] - 0.05
    bars[-1]["volume"] = 500_000
    bars[-1]["high"] = 12.0
    bars[-1]["low"] = 10.5
    bars[-1]["close"] = 11.9  # strong CLV
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[])
    assert out is not None
    assert out["tag"] == TAG_ANTICIPATORY_ACCUMULATION
    assert out["high_vol"] is True


def test_anticipatory_distribution():
    bars = _flat_history(25, vol=100_000, close=12.0)
    for i in range(len(bars) - 10, len(bars)):
        bars[i]["close"] = 12 - (i - (len(bars) - 10)) * 0.15
        bars[i]["volume"] = 150_000
        bars[i]["high"] = bars[i]["close"] + 0.05
        bars[i]["low"] = bars[i]["close"] - 0.05
    bars[-1]["volume"] = 500_000
    bars[-1]["high"] = 11.0
    bars[-1]["low"] = 9.5
    bars[-1]["close"] = 9.6  # weak CLV
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[])
    assert out is not None
    assert out["tag"] == TAG_ANTICIPATORY_DISTRIBUTION


def test_reactive_when_eis_same_session():
    bars = _flat_history(25, vol=100_000, close=10.0)
    bars[-1]["volume"] = 500_000
    bars[-1]["high"] = 12.0
    bars[-1]["low"] = 10.5
    bars[-1]["close"] = 11.9
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[bars[-1]["date"]])
    assert out is not None
    assert out["tag"] == TAG_REACTIVE


def test_reactive_adjacent_session():
    bars = _flat_history(25, vol=100_000)
    bars[-1]["volume"] = 500_000
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[bars[-2]["date"]])
    assert out is not None
    assert out["tag"] == TAG_REACTIVE


def test_ambiguous_without_directional_bias():
    bars = _flat_history(25, vol=100_000, close=10.0)
    bars[-1]["volume"] = 400_000
    bars[-1]["high"] = 10.2
    bars[-1]["low"] = 9.8
    bars[-1]["close"] = 10.0  # mid CLV
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[])
    assert out is not None
    assert out["tag"] == TAG_AMBIGUOUS


def test_peak_anomaly_picks_spike_not_last_quiet_day():
    bars = _flat_history(25, vol=100_000)
    bars[-2]["volume"] = 800_000
    bars[-2]["high"] = 11.0
    bars[-2]["low"] = 10.0
    bars[-2]["close"] = 10.95
    for i in range(len(bars) - 12, len(bars) - 1):
        bars[i]["close"] = 10 + (i % 5) * 0.1
        if i != len(bars) - 2:
            bars[i]["volume"] = 120_000
    out = classify_peak_anomaly(bars, eis_dates=[], lookback_sessions=5)
    assert out is not None
    assert out["date"] == bars[-2]["date"]


def test_quiet_accumulation_without_rvol_spike():
    bars = _flat_history(26, vol=80_000, close=8.0)
    # Rising volume MA + higher lows, no single 3x day
    for i, b in enumerate(bars):
        b["volume"] = 80_000 + i * 4_000
        b["low"] = 7.0 + i * 0.05
        b["high"] = b["low"] + 0.4
        b["close"] = b["low"] + 0.25
    out = classify_bar_at(bars, len(bars) - 1, eis_dates=[], include_quiet=True)
    assert out is not None
    assert out["tag"] == TAG_QUIET_ACCUMULATION
    assert out["high_vol"] is False
