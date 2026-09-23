"""
Centralized fetch for Market Context Score (MCS) benchmark series.

Uses yfinance (Yahoo v8) with retry/backoff. On failure per ticker: None —
never impute synthetic prices.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

MARKET_TICKERS: tuple[str, ...] = ("XBI", "SPY", "^VIX", "HYG", "LQD")
FETCH_PERIOD = "60d"
FETCH_INTERVAL = "1d"
MAX_RETRIES = 3
RETRY_BASE_SEC = 1.5


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _bar_date_str(ts: Any) -> str:
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10]


def _ohlcv_cell(row: Any, col: str) -> float | None:
    """Scalar from a yfinance row cell (handles MultiIndex Series cells)."""
    try:
        v = row.get(col) if hasattr(row, "get") else row[col]
    except Exception:
        return None
    if hasattr(v, "iloc"):
        v = v.iloc[0] if len(v) else None
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:
        return None
    return f


def fetch_ticker_ohlcv(
    ticker: str,
    *,
    period: str = FETCH_PERIOD,
    interval: str = FETCH_INTERVAL,
    max_retries: int = MAX_RETRIES,
) -> list[dict[str, Any]] | None:
    """Return daily {date, open, high, low, close, volume} bars or None on failure.

    ``open`` / ``high`` / ``low`` may be omitted when Yahoo lacks them; ``close``
    and ``volume`` remain the MCS contract. Callers that need CLV must check OHLC.
    """
    try:
        import yfinance as yf
    except ImportError:
        logger.warning("[MCS] yfinance not installed")
        return None

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            df = yf.download(
                ticker,
                period=period,
                interval=interval,
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if df is None or df.empty:
                raise ValueError("empty frame")
            if "Close" not in df.columns:
                raise ValueError("missing Close column")
            out: list[dict[str, Any]] = []
            for idx, row in df.iterrows():
                c = _ohlcv_cell(row, "Close")
                if c is None or c <= 0:
                    continue
                vol = _ohlcv_cell(row, "Volume")
                bar: dict[str, Any] = {
                    "date": _bar_date_str(idx),
                    "close": round(float(c), 6),
                    "volume": round(vol, 2) if vol is not None else None,
                }
                o = _ohlcv_cell(row, "Open")
                h = _ohlcv_cell(row, "High")
                lo = _ohlcv_cell(row, "Low")
                if o is not None and o > 0:
                    bar["open"] = round(float(o), 6)
                if h is not None and h > 0:
                    bar["high"] = round(float(h), 6)
                if lo is not None and lo > 0:
                    bar["low"] = round(float(lo), 6)
                out.append(bar)
            if not out:
                raise ValueError("no valid bars")
            return out
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < max_retries - 1:
                time.sleep(RETRY_BASE_SEC * (2**attempt))
    logger.warning("[MCS] fetch failed for %s after %d tries: %s", ticker, max_retries, last_err)
    return None


def fetch_market_context_series(
    *,
    period: str = FETCH_PERIOD,
    interval: str = FETCH_INTERVAL,
) -> dict[str, list[dict[str, Any]] | None]:
    """Single-session fetch for all MCS benchmark tickers."""
    data: dict[str, list[dict[str, Any]] | None] = {}
    for ticker in MARKET_TICKERS:
        data[ticker] = fetch_ticker_ohlcv(ticker, period=period, interval=interval)
    return data


def closes_by_date(bars: list[dict[str, Any]] | None) -> dict[str, float]:
    if not bars:
        return {}
    return {str(b["date"]): float(b["close"]) for b in bars if b.get("date") and b.get("close") is not None}


def aligned_closes(
    series: dict[str, list[dict[str, Any]] | None],
    ticker: str,
    ref_dates: list[str],
) -> list[float | None]:
    by_date = closes_by_date(series.get(ticker))
    return [by_date.get(d) for d in ref_dates]
