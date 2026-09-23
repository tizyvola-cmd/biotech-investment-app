"""Serve quotes from financial_sheet_snapshot (hourly refresh) — avoid Yahoo fan-out."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from orchestrator_io_paths import FINANCIAL_SHEET_SNAPSHOT_JSON

_log = logging.getLogger(__name__)

_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None
_cache_at = 0.0
_CACHE_TTL_S = 30.0


def _load_financial_rows() -> list[dict[str, Any]]:
    global _cache, _cache_mtime, _cache_at
    path = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return []
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return []
    now = time.time()
    if (
        _cache is not None
        and _cache_mtime == mtime
        and now - _cache_at < _CACHE_TTL_S
    ):
        rows = _cache.get("rows")
        return rows if isinstance(rows, list) else []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _log.debug("financial snapshot load failed: %s", exc)
        return []
    _cache = data if isinstance(data, dict) else {}
    _cache_mtime = mtime
    _cache_at = now
    rows = _cache.get("rows")
    return rows if isinstance(rows, list) else []


def _row_to_quote(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "price": row.get("currentPrice") if row.get("currentPrice") is not None else row.get("last_close"),
        "previousClose": row.get("previousClose") or row.get("last_close"),
        "dailyChangePct": row.get("dailyChange_%"),
        "volume": row.get("volume") or row.get("averageVolume"),
        "avgVolume": row.get("averageVolume") or row.get("averageDailyVolume10Day"),
        "beta": row.get("beta"),
        "marketCap": row.get("marketCap"),
        "source": "financial_sheet_snapshot",
    }


def quotes_from_financial_snapshot(tickers: list[str]) -> dict[str, dict[str, Any]]:
    want = {str(t).strip().upper() for t in tickers if str(t).strip()}
    if not want:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in _load_financial_rows():
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or row.get("Symbol") or row.get("ticker") or "").strip().upper()
        if sym in want and sym not in out:
            out[sym] = _row_to_quote(row)
            if len(out) >= len(want):
                break
    return out


def batch_quotes(
    tickers: list[str],
    *,
    live_fallback: bool = False,
) -> dict[str, Any]:
    """
    Prefer precomputed financial snapshot. Optional live Yahoo only for misses
    when ``live_fallback=True`` (admin / explicit client opt-in).
    """
    cleaned = [str(t).strip().upper() for t in tickers if str(t).strip()][:50]
    quotes = quotes_from_financial_snapshot(cleaned)
    missing = [t for t in cleaned if t not in quotes]
    live_n = 0
    if live_fallback and missing:
        try:
            import fetch_yfinance as _yf
        except Exception as exc:
            _log.debug("yfinance import failed: %s", exc)
            _yf = None
        if _yf is not None:
            for tk in missing[:20]:
                try:
                    data = _yf.fetch_symbol(tk)
                except Exception:
                    continue
                if not data:
                    continue
                quotes[tk] = {
                    "price": data.get("currentPrice"),
                    "previousClose": data.get("previousClose"),
                    "dailyChangePct": data.get("dailyChange_%"),
                    "volume": data.get("volume") or data.get("averageVolume"),
                    "avgVolume": data.get("averageVolume") or data.get("averageDailyVolume10Day"),
                    "beta": data.get("beta"),
                    "marketCap": data.get("marketCap"),
                    "source": "yfinance_live",
                }
                live_n += 1
    return {
        "quotes": quotes,
        "meta": {
            "requested": len(cleaned),
            "from_snapshot": len(cleaned) - len(missing) + (len(missing) - live_n if live_fallback else 0),
            "live_fetches": live_n,
            "missing": [t for t in cleaned if t not in quotes],
        },
    }
