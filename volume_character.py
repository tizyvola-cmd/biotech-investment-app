"""
Volume Character Classifier — tag High-Vol anomalies as anticipatory vs reactive.

Layer only: does not score EIS_market or emit BUY/SELL. Uses relative volume
(median baseline), CLV, UDVR, and calendar/session proximity to confirmed EIS
dates (YYYY-MM-DD).
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

RVOL_HIGH = 3.0
RVOL_EXTREME = 5.0
RVOL_LOOKBACK = 20
UDVR_WINDOW = 10
UDVR_ACCUM = 1.5
UDVR_DIST = 0.67
CLV_ACCUM = 0.5
CLV_DIST = -0.5
REACTIVE_SESSION_RADIUS = 1
ANTICIPATORY_PRIOR_SESSIONS = 2
QUIET_MA_WINDOW = 5
QUIET_SLOPE_LOOKBACK = 18

TAG_REACTIVE = "Reactive"
TAG_ANTICIPATORY_ACCUMULATION = "Anticipatory Accumulation"
TAG_ANTICIPATORY_DISTRIBUTION = "Anticipatory Distribution"
TAG_AMBIGUOUS = "Ambiguous"
TAG_QUIET_ACCUMULATION = "Quiet Accumulation"


def _f(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    return x


def normalize_bars(raw: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Oldest-first daily bars with date/close/volume (+ optional OHLC)."""
    out: list[dict[str, Any]] = []
    for row in raw:
        d = str(row.get("date") or "")[:10]
        if len(d) < 10:
            continue
        close = _f(row.get("close"))
        vol = _f(row.get("volume"))
        if close is None or close <= 0 or vol is None or vol <= 0:
            continue
        bar: dict[str, Any] = {"date": d, "close": close, "volume": vol}
        for k in ("open", "high", "low"):
            x = _f(row.get(k))
            if x is not None and x > 0:
                bar[k] = x
        out.append(bar)
    out.sort(key=lambda b: b["date"])
    return out


def normalize_eis_dates(raw: Iterable[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in raw or []:
        d = str(item or "").strip()[:10]
        if len(d) < 10 or d in seen:
            continue
        seen.add(d)
        out.append(d)
    out.sort()
    return out


def median(values: Sequence[float]) -> float | None:
    vals = [float(v) for v in values if v == v and v > 0]
    if not vals:
        return None
    vals.sort()
    n = len(vals)
    mid = n // 2
    if n % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def rvol_at(bars: Sequence[dict[str, Any]], index: int, *, lookback: int = RVOL_LOOKBACK) -> float | None:
    """Volume_t / median(Volume_{t-lookback..t-1}) — no look-ahead."""
    if index < 1 or index >= len(bars):
        return None
    start = max(0, index - lookback)
    prior = [_f(bars[i]["volume"]) for i in range(start, index)]
    prior_ok = [v for v in prior if v is not None and v > 0]
    if len(prior_ok) < max(5, lookback // 2):
        return None
    base = median(prior_ok)
    if base is None or base <= 0:
        return None
    vol = _f(bars[index]["volume"])
    if vol is None or vol <= 0:
        return None
    return vol / base


def clv_at(bar: dict[str, Any]) -> float | None:
    """Close Location Value in [-1, +1]."""
    high = _f(bar.get("high"))
    low = _f(bar.get("low"))
    close = _f(bar.get("close"))
    if high is None or low is None or close is None:
        return None
    span = high - low
    if span <= 0:
        return 0.0
    return ((close - low) - (high - close)) / span


def udvr_ending_at(
    bars: Sequence[dict[str, Any]],
    index: int,
    *,
    window: int = UDVR_WINDOW,
) -> float | None:
    """UpVol / DownVol over the last ``window`` sessions ending at ``index``."""
    if index < 1 or index >= len(bars):
        return None
    start = max(1, index - window + 1)
    up = 0.0
    down = 0.0
    for i in range(start, index + 1):
        c = _f(bars[i]["close"])
        p = _f(bars[i - 1]["close"])
        v = _f(bars[i]["volume"])
        if c is None or p is None or v is None or v <= 0:
            continue
        if c > p:
            up += v
        elif c < p:
            down += v
    if down <= 0:
        return None if up <= 0 else 99.0
    return up / down


def _nearest_bar_index(bar_dates: Sequence[str], day: str) -> int | None:
    """Map a calendar day onto the nearest trading session index."""
    if not bar_dates:
        return None
    if day in bar_dates:
        return list(bar_dates).index(day)
    # Prefer last session on/before the event; else first session after.
    before = [i for i, d in enumerate(bar_dates) if d <= day]
    if before:
        return before[-1]
    after = [i for i, d in enumerate(bar_dates) if d >= day]
    return after[0] if after else None


def eis_session_indices(bars: Sequence[dict[str, Any]], eis_dates: Sequence[str]) -> list[int]:
    dates = [str(b["date"])[:10] for b in bars]
    out: list[int] = []
    seen: set[int] = set()
    for d in normalize_eis_dates(eis_dates):
        idx = _nearest_bar_index(dates, d)
        if idx is None or idx in seen:
            continue
        seen.add(idx)
        out.append(idx)
    return out


def timing_vs_eis(
    peak_index: int,
    eis_indices: Sequence[int],
    *,
    reactive_radius: int = REACTIVE_SESSION_RADIUS,
    anticipatory_prior: int = ANTICIPATORY_PRIOR_SESSIONS,
) -> str:
    """Return 'reactive' | 'anticipatory' | 'near_eis'."""
    for ei in eis_indices:
        if abs(int(ei) - int(peak_index)) <= reactive_radius:
            return "reactive"
    for ei in eis_indices:
        if peak_index - anticipatory_prior <= int(ei) < peak_index:
            return "near_eis"
    return "anticipatory"


def quiet_accumulation(
    bars: Sequence[dict[str, Any]],
    *,
    eis_indices: Sequence[int],
    end_index: int | None = None,
) -> bool:
    """Gradual volume rise + higher lows, with no EIS in the lookback window."""
    if not bars:
        return False
    end = len(bars) - 1 if end_index is None else end_index
    if end < QUIET_SLOPE_LOOKBACK:
        return False
    start = end - QUIET_SLOPE_LOOKBACK + 1
    for ei in eis_indices:
        if start <= int(ei) <= end:
            return False

    # 5d MA of volume over the window; require positive slope.
    mas: list[float] = []
    for i in range(start, end + 1):
        w0 = max(0, i - QUIET_MA_WINDOW + 1)
        chunk = [_f(bars[j]["volume"]) for j in range(w0, i + 1)]
        ok = [v for v in chunk if v is not None and v > 0]
        if len(ok) < QUIET_MA_WINDOW:
            continue
        mas.append(sum(ok) / len(ok))
    if len(mas) < 6:
        return False
    slope = (mas[-1] - mas[0]) / max(1, len(mas) - 1)
    if slope <= 0:
        return False

    mid = start + (end - start) // 2
    first_lows = [_f(bars[i].get("low", bars[i]["close"])) for i in range(start, mid + 1)]
    second_lows = [_f(bars[i].get("low", bars[i]["close"])) for i in range(mid + 1, end + 1)]
    first_ok = [x for x in first_lows if x is not None and x > 0]
    second_ok = [x for x in second_lows if x is not None and x > 0]
    if not first_ok or not second_ok:
        return False
    return min(second_ok) > min(first_ok)


def classify_bar_at(
    bars: Sequence[dict[str, Any]],
    index: int,
    *,
    eis_dates: Sequence[str] | None = None,
    include_quiet: bool = True,
) -> dict[str, Any] | None:
    """Classify a single session. Returns None when there is no anomaly/tag."""
    bars_n = normalize_bars(list(bars))
    if index < 0 or index >= len(bars_n):
        return None
    eis_idx = eis_session_indices(bars_n, eis_dates or [])
    rvol = rvol_at(bars_n, index)
    high = rvol is not None and rvol >= RVOL_HIGH
    extreme = rvol is not None and rvol >= RVOL_EXTREME
    clv = clv_at(bars_n[index])
    udvr = udvr_ending_at(bars_n, index)
    timing = timing_vs_eis(index, eis_idx) if high else None
    quiet = include_quiet and quiet_accumulation(bars_n, eis_indices=eis_idx, end_index=index)

    tag: str | None = None
    if high:
        if timing == "reactive":
            tag = TAG_REACTIVE
        elif timing == "anticipatory":
            if clv is not None and udvr is not None and clv > CLV_ACCUM and udvr > UDVR_ACCUM:
                tag = TAG_ANTICIPATORY_ACCUMULATION
            elif clv is not None and udvr is not None and clv < CLV_DIST and udvr < UDVR_DIST:
                tag = TAG_ANTICIPATORY_DISTRIBUTION
            else:
                tag = TAG_AMBIGUOUS
        else:
            tag = TAG_AMBIGUOUS
    elif quiet:
        tag = TAG_QUIET_ACCUMULATION
    else:
        return None

    return {
        "date": bars_n[index]["date"],
        "tag": tag,
        "rvol": round(rvol, 3) if rvol is not None else None,
        "high_vol": high,
        "extreme_vol": extreme,
        "clv": round(clv, 4) if clv is not None else None,
        "udvr": round(udvr, 4) if udvr is not None else None,
        "timing": timing,
        "quiet_accumulation": quiet,
        "volume": bars_n[index]["volume"],
        "close": bars_n[index]["close"],
    }


def classify_latest(
    bars: Sequence[dict[str, Any]],
    *,
    eis_dates: Sequence[str] | None = None,
    include_quiet: bool = True,
) -> dict[str, Any] | None:
    bars_n = normalize_bars(list(bars))
    if not bars_n:
        return None
    return classify_bar_at(bars_n, len(bars_n) - 1, eis_dates=eis_dates, include_quiet=include_quiet)


def classify_peak_anomaly(
    bars: Sequence[dict[str, Any]],
    *,
    eis_dates: Sequence[str] | None = None,
    lookback_sessions: int = 5,
    include_quiet: bool = True,
) -> dict[str, Any] | None:
    """Classify the highest-RVOL session in the last ``lookback_sessions`` bars."""
    bars_n = normalize_bars(list(bars))
    if len(bars_n) < 2:
        return None
    start = max(1, len(bars_n) - lookback_sessions)
    best_i: int | None = None
    best_r: float = -1.0
    for i in range(start, len(bars_n)):
        r = rvol_at(bars_n, i)
        if r is None:
            continue
        if r > best_r:
            best_r = r
            best_i = i
    if best_i is None:
        return classify_latest(bars_n, eis_dates=eis_dates, include_quiet=include_quiet)
    return classify_bar_at(bars_n, best_i, eis_dates=eis_dates, include_quiet=include_quiet)


def classify_ticker_from_history(
    ticker: str,
    *,
    days: int = 60,
    eis_dates: Sequence[str] | None = None,
    include_quiet: bool = True,
) -> dict[str, Any]:
    """Fetch Yahoo history and classify the recent volume peak."""
    from market_volume_history import fetch_volume_history

    hist = fetch_volume_history(ticker, days=max(40, int(days)))
    bars = hist.get("bars") or []
    peak = classify_peak_anomaly(bars, eis_dates=eis_dates, include_quiet=include_quiet)
    return {
        "ticker": str(ticker or "").strip().upper(),
        "updated_at": hist.get("updated_at"),
        "error": hist.get("error"),
        "classification": peak,
        "bars_used": len(normalize_bars(bars)),
    }
