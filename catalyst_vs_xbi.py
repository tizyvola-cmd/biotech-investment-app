"""
Catalyst table — relative move vs XBI (Framework v2 signal 5).

Display only — not a Soft BUY/SELL input.

First release uses the simplified formula (beta = 1):
  RelativeMove_simple(t) = StockReturn(t) − SectorReturn(t)

Rolling β vs XBI can be added later; do not invent β = 0 or silent zeros.
Missing stock or XBI history → None → UI "—".
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

logger = logging.getLogger("supernova.catalyst_vs_xbi")

_CACHE_DIR = Path("data") / "cache" / "catalyst_vs_xbi"
_TTL_S = 4 * 60 * 60
_MAX_TICKERS = 80
_HORIZON_D = 5
_SECTOR = "XBI"


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _finite(v: Any) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def simple_return(closes: Sequence[Any], days: int = _HORIZON_D) -> float | None:
    vals = [_finite(x) for x in closes]
    clean = [x for x in vals if x is not None]
    if len(clean) < days + 1:
        return None
    start = clean[-(days + 1)]
    end = clean[-1]
    if start is None or end is None or start <= 0:
        return None
    return (end - start) / start


def relative_move_simple(
    stock_return: Any,
    sector_return: Any,
) -> float | None:
    """StockReturn − SectorReturn (β=1). None if either leg is missing."""
    a = _finite(stock_return)
    b = _finite(sector_return)
    if a is None or b is None:
        return None
    return round(a - b, 6)


def build_vs_xbi_row(
    ticker: str,
    *,
    stock_closes: Sequence[float] | None = None,
    xbi_closes: Sequence[float] | None = None,
    days: int = _HORIZON_D,
) -> dict[str, Any]:
    tk = ticker.strip().upper()
    stock_ret = simple_return(stock_closes or [], days)
    xbi_ret = simple_return(xbi_closes or [], days)
    rel = relative_move_simple(stock_ret, xbi_ret)
    return {
        "ticker": tk,
        "horizon_days": days,
        "stock_return": None if stock_ret is None else round(stock_ret, 6),
        "xbi_return": None if xbi_ret is None else round(xbi_ret, 6),
        "relative_move": rel,
        "beta": 1.0,  # simplified first release — not estimated
        "method": "simple_beta1",
        "status": "ok" if rel is not None else "none",
        "updated_at": _now_iso(),
    }


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    return doc if isinstance(doc, dict) else None


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _cache_path(ticker: str) -> Path:
    return _CACHE_DIR / f"{ticker.strip().upper()}.json"


def parse_tickers(raw: str | list[str] | None) -> list[str]:
    if not raw:
        return []
    parts = raw if isinstance(raw, list) else str(raw).replace(";", ",").split(",")
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        tk = str(part).strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        out.append(tk)
    return out[:_MAX_TICKERS]


def _closes(ticker: str) -> list[float]:
    try:
        from prediction.scoring_data import load_price_series

        closes, _ = load_price_series(ticker, "60d")
        c = [float(x) for x in (closes or []) if _finite(x) is not None]
        if len(c) >= _HORIZON_D + 1:
            return c
    except Exception:
        pass
    try:
        import yfinance as yf

        hist = yf.Ticker(ticker).history(period="3mo", auto_adjust=False)
        if hist is None or hist.empty:
            return []
        return [float(x) for x in hist["Close"].tolist() if _finite(x) is not None]
    except Exception:
        return []


def fetch_catalyst_vs_xbi(
    tickers: str | list[str] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    wanted = parse_tickers(tickers)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "note": "simple_beta1_vs_xbi",
        "sector": _SECTOR,
    }
    if not wanted:
        payload["error"] = "empty_tickers"
        return payload

    xbi_closes = _closes(_SECTOR)
    now = time.time()
    for tk in wanted:
        path = _cache_path(tk)
        cached = _read_json(path)
        fresh = cached is not None and path.is_file() and (now - path.stat().st_mtime) < _TTL_S
        if fresh and not force:
            payload["rows"][tk] = cached
            continue
        try:
            row = build_vs_xbi_row(tk, stock_closes=_closes(tk), xbi_closes=xbi_closes)
        except Exception as exc:
            logger.warning("vs XBI fetch failed %s: %s", tk, exc)
            if cached:
                payload["rows"][tk] = cached
            continue
        if row.get("relative_move") is None:
            row["error"] = "insufficient_history"
        _write_json(path, row)
        payload["rows"][tk] = row
    return payload


def refresh_catalyst_vs_xbi_universe(*, force: bool = False) -> dict[str, Any]:
    tickers: list[str] = []
    try:
        from event_vol_index import upcoming_pairs_from_snapshots

        tickers = parse_tickers([t for t, _ in upcoming_pairs_from_snapshots(60)])
    except Exception as exc:
        logger.warning("vs XBI universe scan failed: %s", exc)
    return fetch_catalyst_vs_xbi(tickers, force=force)
