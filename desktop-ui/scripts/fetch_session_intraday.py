#!/usr/bin/env python3
"""
Hourly RTH prices for one Nasdaq session date (what-if Strong replay).

Usage:
  python fetch_session_intraday.py TICKER1,TICKER2 2026-07-15

Stdout JSON:
  { "session_date": "2026-07-15", "series": { "AAPL": [{"t":"...", "price": 1.23}] } }
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone

_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")

try:
    from zoneinfo import ZoneInfo

    NY = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    NY = timezone.utc  # type: ignore[assignment]


def _normalize_tickers(raw: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for p in raw.replace(";", ",").split(","):
        t = p.strip().upper()
        if not t or t in seen or "TOTALE" in t or len(t) > 12 or not _TICKER_RE.match(t):
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 80:
            break
    return out


def _to_ny(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(NY)


def _points_from_close(close_series, session_date: str) -> list[dict]:
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

    points: list[dict] = []
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
        if ny.date().isoformat() != session_date:
            continue
        if ny.hour < 9 or ny.hour > 16:
            continue
        points.append({"t": ny.isoformat(), "price": round(price, 4)})
    points.sort(key=lambda p: p["t"])
    return points


def _extract_close(raw, ticker: str):
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


def fetch_session(session_date: str, tickers: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {t: [] for t in tickers}
    if not tickers:
        return out

    try:
        import yfinance as yf
    except ImportError:
        return out

    try:
        start = (datetime.fromisoformat(session_date) - timedelta(days=5)).date().isoformat()
        end = (datetime.fromisoformat(session_date) + timedelta(days=2)).date().isoformat()
    except ValueError:
        return out

    try:
        raw = yf.download(
            tickers=tickers if len(tickers) > 1 else tickers[0],
            start=start,
            end=end,
            interval="5m",
            group_by="column",
            auto_adjust=False,
            progress=False,
            threads=True,
        )
    except Exception:
        return out

    if raw is None or getattr(raw, "empty", True):
        return out

    if len(tickers) == 1:
        pts = _points_from_close(_extract_close(raw, tickers[0]), session_date)
        out[tickers[0]] = pts
        return out

    for tk in tickers:
        close = _extract_close(raw, tk)
        out[tk] = _points_from_close(close, session_date)
    return out


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: fetch_session_intraday.py TICKERS SESSION_DATE"}))
        sys.exit(1)
    tickers = _normalize_tickers(sys.argv[1])
    session_date = sys.argv[2].strip()
    series = fetch_session(session_date, tickers)
    print(json.dumps({"session_date": session_date, "series": series}))


if __name__ == "__main__":
    main()
