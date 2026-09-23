"""
Batch Yahoo intraday prices → 1 point/hour, split into:
  - prior: Nasdaq RTH session immediately before live (Soft BUY ↑≥2d "yesterday")
  - live: current session truncated to now (America/New_York), or the last
    completed session when Yahoo has no bars for calendar "today" yet
    (pre-open / weekend / holiday) so charts still show the settled day
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import re

logger = logging.getLogger("supernova.market_intraday")

_CACHE: dict[str, Any] = {"at": 0.0, "key": "", "payload": None}
_CACHE_TTL_S = 2 * 60
_MAX_TICKERS = 80
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")

try:
    from zoneinfo import ZoneInfo

    NY = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    NY = timezone.utc  # type: ignore[assignment]


def _normalize_tickers(raw: list[str] | str) -> list[str]:
    if isinstance(raw, str):
        parts = raw.replace(";", ",").split(",")
    else:
        parts = list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        t = str(p or "").strip().upper()
        if (
            not t
            or t in seen
            or "TOTALE" in t
            or len(t) > 12
            or not _TICKER_RE.match(t)
        ):
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= _MAX_TICKERS:
            break
    return out


def _to_ny(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(NY)


def _points_from_close(close_series) -> list[dict[str, Any]]:
    """5m close → hourly last close, with NY wall-clock metadata."""
    if close_series is None:
        return []
    try:
        s = close_series.dropna()
    except Exception:
        return []
    if getattr(s, "empty", True):
        return []
    try:
        hourly = s.groupby([s.index.year, s.index.month, s.index.day, s.index.hour]).last()
    except Exception:
        try:
            hourly = s.resample("1h").last().dropna()
        except Exception:
            hourly = s

    points: list[dict[str, Any]] = []
    for idx, val in hourly.items():
        try:
            price = float(val)
        except (TypeError, ValueError):
            continue
        if not (price > 0):
            continue
        if isinstance(idx, tuple) and len(idx) >= 4:
            y, m, d, h = idx[0], idx[1], idx[2], idx[3]
            try:
                # Yahoo index is typically exchange-local / UTC — treat as UTC then → NY.
                dt = datetime(int(y), int(m), int(d), int(h), tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
        else:
            try:
                dt = idx.to_pydatetime()  # type: ignore[union-attr]
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
            except Exception:
                continue
        ny = _to_ny(dt)
        # Regular hours roughly 9–16 ET (keep 9–16 inclusive for hourly buckets).
        if ny.hour < 9 or ny.hour > 16:
            continue
        points.append(
            {
                "t": ny.isoformat(),
                "price": round(price, 4),
                "session_date": ny.date().isoformat(),
                "hour_et": ny.hour,
            }
        )
    points.sort(key=lambda p: p["t"])
    return points


def _session_dates(all_points: list[dict[str, Any]]) -> list[str]:
    dates = sorted({p["session_date"] for p in all_points if p.get("session_date")})
    return dates


def _is_complete_session(points_for_day: list[dict[str, Any]]) -> bool:
    """A session is complete if we have a bucket at/after 15:00 ET (near close)."""
    return any(int(p.get("hour_et") or 0) >= 15 for p in points_for_day)


def _filter_day(
    points: list[dict[str, Any]],
    session_date: str,
    *,
    until: datetime | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in points:
        if p.get("session_date") != session_date:
            continue
        if until is not None:
            try:
                pt = datetime.fromisoformat(p["t"])
            except Exception:
                continue
            if pt > until:
                continue
        out.append({"t": p["t"], "price": p["price"]})
    return out


def _last_price(points: list[dict[str, Any]]) -> float | None:
    if not points:
        return None
    try:
        price = float(points[-1]["price"])
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    return price if price > 0 else None


def _extract_close_series(raw, ticker: str):
    if hasattr(raw.columns, "nlevels") and raw.columns.nlevels > 1:
        if ("Close", ticker) in raw.columns:
            return raw[("Close", ticker)]
        if (ticker, "Close") in raw.columns:
            return raw[(ticker, "Close")]
        try:
            return raw["Close"][ticker]
        except Exception:
            return None
    if "Close" in raw.columns:
        return raw["Close"]
    try:
        return raw.iloc[:, 0]
    except Exception:
        return None


def fetch_intraday_1h(tickers: list[str] | str, *, force: bool = False) -> dict[str, Any]:
    """
    Return prior (last completed Nasdaq day) + live (today to now) hourly series.
    Backward-compatible ``series`` = live if non-empty else prior.
    """
    tks = _normalize_tickers(tickers)
    cache_key = ",".join(tks)
    now = time.time()
    if (
        not force
        and _CACHE.get("payload") is not None
        and _CACHE.get("key") == cache_key
        and now - float(_CACHE.get("at") or 0) < _CACHE_TTL_S
    ):
        return _CACHE["payload"]  # type: ignore[return-value]

    empty_series = {t: [] for t in tks}
    now_ny = datetime.now(tz=NY)
    today_ny = now_ny.date().isoformat()

    base_payload: dict[str, Any] = {
        "updated_at": datetime.now().astimezone().isoformat(),
        "interval": "1h",
        "source": "yahoo",
        "as_of": now_ny.isoformat(),
        "prior": {"session_date": None, "series": dict(empty_series)},
        "live": {"session_date": None, "series": dict(empty_series)},
        "series": dict(empty_series),
    }

    if not tks:
        return base_payload

    try:
        import yfinance as yf
    except ImportError:
        base_payload["error"] = "yfinance_not_installed"
        return base_payload

    try:
        raw = yf.download(
            tks,
            period="5d",
            interval="5m",
            auto_adjust=True,
            progress=False,
            threads=True,
            group_by="column",
        )
    except Exception as exc:
        logger.warning("yf.download intraday failed: %s", exc)
        base_payload["error"] = str(exc)[:200]
        return base_payload

    if raw is None or (hasattr(raw, "empty") and raw.empty):
        base_payload["error"] = "empty"
        return base_payload

    per_ticker_points: dict[str, list[dict[str, Any]]] = {}
    all_pts: list[dict[str, Any]] = []
    for t in tks:
        try:
            s = _extract_close_series(raw, t)
            pts = _points_from_close(s)
            per_ticker_points[t] = pts
            all_pts.extend(pts)
        except Exception as exc:
            logger.debug("intraday points %s: %s", t, exc)
            per_ticker_points[t] = []

    dates = _session_dates(all_pts)
    complete_dates = [
        d
        for d in dates
        if _is_complete_session([p for p in all_pts if p.get("session_date") == d])
    ]

    prior_date = complete_dates[-1] if complete_dates else (dates[-1] if dates else None)
    # Live = today NY if we have any points today; else None.
    live_date = today_ny if today_ny in dates else None
    # If today is already marked complete and market closed, still allow live=today
    # but prior should be previous complete day when available.
    if live_date and prior_date == live_date and len(complete_dates) >= 2:
        prior_date = complete_dates[-2]
    elif live_date and prior_date == live_date and not _is_complete_session(
        [p for p in all_pts if p.get("session_date") == live_date]
    ):
        # Intraday: prior = last complete before today
        prior_date = complete_dates[-1] if complete_dates and complete_dates[-1] != live_date else (
            complete_dates[-2] if len(complete_dates) >= 2 else prior_date
        )
    elif (
        not live_date
        and prior_date
        and len(complete_dates) >= 2
        and prior_date == complete_dates[-1]
    ):
        # Pre-open / weekend / holiday: Yahoo has no calendar-today bars, but the
        # sheet Var. Giorn. is still the last completed session. Expose that day
        # as settled live and shift prior to the day before — otherwise Soft BUY
        # ↑≥2d treats the same session as both "today" and "yesterday".
        live_date = prior_date
        prior_date = complete_dates[-2]

    prior_series: dict[str, list[dict[str, Any]]] = {}
    live_series: dict[str, list[dict[str, Any]]] = {}
    # Previous regular close for each block — same baseline as Yahoo Var. Giorn. %
    # (not the first RTH hour, which can flip sign after a gap).
    prior_prev_close: dict[str, float | None] = {}
    live_prev_close: dict[str, float | None] = {}
    day_before_prior = None
    if prior_date and dates:
        try:
            i = dates.index(prior_date)
            day_before_prior = dates[i - 1] if i > 0 else None
        except ValueError:
            day_before_prior = None

    for t in tks:
        pts = per_ticker_points.get(t) or []
        prior_series[t] = _filter_day(pts, prior_date) if prior_date else []
        live_series[t] = (
            _filter_day(pts, live_date, until=now_ny) if live_date else []
        )
        if prior_date:
            # Live session baseline = last print of the prior completed day.
            live_prev_close[t] = _last_price(_filter_day(pts, prior_date))
        else:
            live_prev_close[t] = None
        if day_before_prior:
            prior_prev_close[t] = _last_price(_filter_day(pts, day_before_prior))
        else:
            prior_prev_close[t] = None

    active_series = live_series if any(live_series[t] for t in tks) else prior_series
    payload = {
        "updated_at": datetime.now().astimezone().isoformat(),
        "interval": "1h",
        "source": "yahoo",
        "as_of": now_ny.isoformat(),
        "prior": {
            "session_date": prior_date,
            "series": prior_series,
            "prev_close": prior_prev_close,
        },
        "live": {
            "session_date": live_date,
            "series": live_series,
            "prev_close": live_prev_close,
        },
        "series": active_series,
    }
    _CACHE["at"] = now
    _CACHE["key"] = cache_key
    _CACHE["payload"] = payload
    return payload
