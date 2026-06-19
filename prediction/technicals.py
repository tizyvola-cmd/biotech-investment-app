"""
Technical indicators for the Supernova scoring engine.
Pure functions — no I/O.
"""
from __future__ import annotations

import math
from typing import Sequence


def sma(values: Sequence[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    window = values[-period:]
    return sum(window) / len(window)


def rsi14(closes: Sequence[float]) -> float | None:
    if len(closes) < 15:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    if len(gains) < 14:
        return None
    avg_g = sum(gains[-14:]) / 14.0
    avg_l = sum(losses[-14:]) / 14.0
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return round(100.0 - 100.0 / (1.0 + rs), 2)


def atr14(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]) -> float | None:
    """Average True Range (14 periods). Falls back to close-only proxy if H/L missing."""
    n = len(closes)
    if n < 15:
        return None
    trs: list[float] = []
    for i in range(1, n):
        h = highs[i] if i < len(highs) else closes[i]
        l = lows[i] if i < len(lows) else closes[i]
        prev_c = closes[i - 1]
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    if len(trs) < 14:
        return None
    return sum(trs[-14:]) / 14.0


def atr14_from_closes(closes: Sequence[float]) -> float | None:
    """Proxy ATR when only close series is available."""
    if len(closes) < 15:
        return None
    trs = [abs(closes[i] - closes[i - 1]) for i in range(1, len(closes))]
    return sum(trs[-14:]) / 14.0


def bollinger_bands(
    closes: Sequence[float],
    period: int = 20,
    num_std: float = 2.0,
) -> tuple[float | None, float | None, float | None, float | None]:
    """Returns (upper, middle, lower, width_ratio). width = (upper-lower)/middle."""
    if len(closes) < period:
        return None, None, None, None
    window = closes[-period:]
    mid = sum(window) / len(window)
    if mid <= 0:
        return None, None, None, None
    var = sum((x - mid) ** 2 for x in window) / len(window)
    std = math.sqrt(var)
    upper = mid + num_std * std
    lower = mid - num_std * std
    width = (upper - lower) / mid if mid > 0 else None
    return upper, mid, lower, width


def slope_pct(closes: Sequence[float], lookback: int = 20) -> float | None:
    """Percent change close[-1] vs close[-lookback]."""
    if len(closes) < lookback + 1:
        return None
    p0 = closes[-lookback - 1] if len(closes) > lookback else closes[-lookback]
    p1 = closes[-1]
    if p0 <= 0:
        return None
    return round((p1 / p0 - 1.0) * 100.0, 4)


def linear_regression_slope_pct(closes: Sequence[float], lookback: int = 20) -> float | None:
    """Linear regression slope as %/day relative to first price in window."""
    if len(closes) < max(5, lookback // 2):
        return None
    s = closes[-lookback:] if len(closes) >= lookback else closes
    p0 = s[0] if s[0] > 0 else 1.0
    n = len(s)
    x_mean = (n - 1) / 2.0
    y = [(p / p0 - 1.0) * 100.0 for p in s]
    y_mean = sum(y) / n
    num = sum((i - x_mean) * (y[i] - y_mean) for i in range(n))
    den = sum((i - x_mean) ** 2 for i in range(n))
    if den == 0:
        return None
    return round(num / den, 4)


def return_pct(closes: Sequence[float], lookback: int) -> float | None:
    return slope_pct(closes, lookback)
