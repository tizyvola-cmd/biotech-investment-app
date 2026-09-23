"""
Daily share volume bars for loss-analysis EIS overlay chart (Yahoo via yfinance).

Also serves the KPI snapshot "Vol %" column: the running session volume expressed
as a percentage of the previous Nasdaq session (last market close), batched over
many tickers with a per-ticker cache.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from prediction.market_context_fetcher import fetch_ticker_ohlcv

logger = logging.getLogger("supernova.market_volume")

_CACHE: dict[str, Any] = {"at": 0.0, "key": "", "payload": None}
_CACHE_TTL_S = 15 * 60
_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")

# Per-ticker rows. The old batch cache was keyed on the exact ticker list, so
# KPI vs rescue vs a resorted table each missed and re-hit Yahoo.
_VS_PREV_ROWS: dict[str, dict[str, Any]] = {}
_VS_PREV_TTL_S = 5 * 60
_VS_PREV_MAX_TICKERS = 80
_VS_PREV_FALLBACK_MAX = 24


def clear_volume_vs_prev_cache() -> None:
    _VS_PREV_ROWS.clear()


def _vs_prev_row_complete(row: Any) -> bool:
    """Usable KPI / desk cell: volume % plus the two session closes."""
    if not isinstance(row, dict) or row.get("pct_of_prev") is None:
        return False
    lc = row.get("last_close")
    pc = row.get("prev_close")
    try:
        return float(lc) > 0 and float(pc) > 0
    except (TypeError, ValueError):
        return False


def partition_vs_prev_cache(
    tickers: list[str],
    *,
    now: float,
    force: bool = False,
    ttl_s: float = _VS_PREV_TTL_S,
    store: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Split tickers into fresh cached rows vs names that still need Yahoo."""
    src = _VS_PREV_ROWS if store is None else store
    fresh: dict[str, Any] = {}
    stale: list[str] = []
    for tk in tickers:
        hit = src.get(tk)
        row = hit.get("row") if isinstance(hit, dict) else None
        at = float(hit.get("at") or 0) if isinstance(hit, dict) else 0.0
        if (
            not force
            and _vs_prev_row_complete(row)
            and now - at < ttl_s
        ):
            fresh[tk] = row
        else:
            stale.append(tk)
    return fresh, stale


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def fetch_volume_history(ticker: str, *, days: int = 35) -> dict[str, Any]:
    tk = str(ticker or "").strip().upper()
    if not tk or not _TICKER_RE.match(tk):
        return {
            "ticker": tk,
            "bars": [],
            "updated_at": None,
            "error": "invalid_ticker",
        }

    days = max(1, min(int(days), 400))
    cache_key = f"{tk}:{days}"
    now = time.time()
    cached = _CACHE.get("payload")
    if (
        isinstance(cached, dict)
        and _CACHE.get("key") == cache_key
        and now - float(_CACHE.get("at") or 0) < _CACHE_TTL_S
    ):
        return cached

    if days <= 31:
        period = "1mo"
    elif days <= 93:
        period = "3mo"
    elif days <= 200:
        period = "6mo"
    else:
        # 1Y chart asks ~370 calendar days; Yahoo `1y` can come up a few
        # sessions short, so pull `2y` and clip to `days`.
        period = "2y"
    ohlcv = fetch_ticker_ohlcv(tk, period=period, interval="1d")
    if not ohlcv:
        payload: dict[str, Any] = {
            "ticker": tk,
            "bars": [],
            "updated_at": None,
            "error": "fetch_failed",
        }
        _CACHE.update({"at": now, "key": cache_key, "payload": payload})
        return payload

    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    bars: list[dict[str, Any]] = []
    for row in ohlcv:
        d = str(row.get("date") or "")[:10]
        if not d or d < cutoff:
            continue
        close_raw = row.get("close")
        try:
            c = float(close_raw)
        except (TypeError, ValueError):
            c = float("nan")
        if c != c or c <= 0:
            continue
        vol = row.get("volume")
        v_out: float | None = None
        if vol is not None:
            try:
                v = float(vol)
                if v == v and v > 0:
                    v_out = round(v, 0)
            except (TypeError, ValueError):
                pass
        bar: dict[str, Any] = {"date": d, "close": round(c, 4), "volume": v_out}
        for k in ("open", "high", "low"):
            raw_px = row.get(k)
            if raw_px is None:
                continue
            try:
                px = float(raw_px)
            except (TypeError, ValueError):
                continue
            if px == px and px > 0:
                bar[k] = round(px, 4)
        bars.append(bar)

    bars.sort(key=lambda b: b["date"])
    payload = {
        "ticker": tk,
        "bars": bars,
        "updated_at": _now_iso(),
        "error": None,
    }
    _CACHE.update({"at": now, "key": cache_key, "payload": payload})
    return payload


def _normalize_tickers(raw: list[str] | str) -> list[str]:
    parts = raw.replace(";", ",").split(",") if isinstance(raw, str) else list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        t = str(p or "").strip().upper()
        if not t or t in seen or "TOTALE" in t or not _TICKER_RE.match(t):
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= _VS_PREV_MAX_TICKERS:
            break
    return out


def _extract_ohlcv_series(raw, ticker: str, field: str):
    if hasattr(raw.columns, "nlevels") and raw.columns.nlevels > 1:
        if (field, ticker) in raw.columns:
            return raw[(field, ticker)]
        if (ticker, field) in raw.columns:
            return raw[(ticker, field)]
        try:
            return raw[field][ticker]
        except Exception:
            return None
    return raw[field] if field in raw.columns else None


def _extract_volume_series(raw, ticker: str):
    return _extract_ohlcv_series(raw, ticker, "Volume")


def _usable_sessions(series) -> list[tuple[str, float]]:
    """Daily bars with a usable volume, oldest first."""
    if series is None:
        return []
    out: list[tuple[str, float]] = []
    for idx, value in series.items():
        try:
            v = float(value)
        except (TypeError, ValueError):
            continue
        if v != v or v <= 0:
            continue
        day = getattr(idx, "date", lambda: idx)()
        out.append((str(day)[:10], v))
    return out


def _last_two_sessions(series) -> list[tuple[str, float]]:
    """The two most recent daily bars with a usable volume, oldest first."""
    return _usable_sessions(series)[-2:]


VOLUME_SURGE_PCT = 150
VOLUME_SURGE_7D_PAIRS = 7
VOLUME_DELTA_METHOD = "price_sign_proxy"
_OBV_DIVERGE_BARS = 3


def volume_delta_signed(last_close: float | None, prev_close: float | None, volume: float | None) -> float | None:
    """OHLCV proxy: +volume on up close, −volume on down close. Not Lee-Ready."""
    if last_close is None or prev_close is None or volume is None:
        return None
    try:
        lc = float(last_close)
        pc = float(prev_close)
        vol = float(volume)
    except (TypeError, ValueError):
        return None
    if vol != vol or vol <= 0 or lc != lc or pc != pc:
        return None
    if lc > pc:
        return round(vol)
    if lc < pc:
        return round(-vol)
    return 0.0


def obv_divergence_flag(
    sessions: list[tuple[str, float]],
    close_by_day: dict[str, float],
    *,
    lookback: int = 6,
    diverge_bars: int = _OBV_DIVERGE_BARS,
) -> bool:
    """True when net price and net OBV over the lookback have opposite signs."""
    if len(sessions) < diverge_bars + 1:
        return False
    window = sessions[-(lookback + 1) :]
    obv = 0.0
    prev_c: float | None = None
    path: list[tuple[float, float]] = []
    for day, vol in window:
        c = close_by_day.get(day)
        if c is None:
            continue
        if prev_c is not None:
            if c > prev_c:
                obv += vol
            elif c < prev_c:
                obv -= vol
            path.append((c, obv))
        prev_c = c
    if len(path) < diverge_bars:
        return False
    px_dir = path[-1][0] - path[0][0]
    obv_dir = path[-1][1] - path[0][1]
    if px_dir == 0 or obv_dir == 0:
        return False
    return (px_dir > 0) != (obv_dir > 0)


def volume_surge_windows(
    sessions: list[tuple[str, float]],
    *,
    surge_pct: float = VOLUME_SURGE_PCT,
    lookback_pairs: int = VOLUME_SURGE_7D_PAIRS,
) -> dict[str, Any]:
    """24h = last vs prev; 7d = any of the last ``lookback_pairs`` session pairs."""
    out: dict[str, Any] = {
        "surge_24h": False,
        "surge_7d": False,
        "pct_of_prev": None,
        "max_pct_7d": None,
    }
    if len(sessions) < 2:
        return out
    pairs: list[float] = []
    for i in range(1, len(sessions)):
        prev_vol = sessions[i - 1][1]
        vol = sessions[i][1]
        if prev_vol <= 0:
            continue
        pairs.append(vol / prev_vol * 100)
    if not pairs:
        return out
    last_pct = pairs[-1]
    out["pct_of_prev"] = round(last_pct, 1)
    out["surge_24h"] = last_pct >= surge_pct
    window = pairs[-max(1, lookback_pairs) :]
    out["max_pct_7d"] = round(max(window), 1)
    out["surge_7d"] = any(p >= surge_pct for p in window)
    return out


def _close_series_by_day(raw: Any, tk: str) -> dict[str, float]:
    for field in ("Close", "Adj Close"):
        series = _extract_ohlcv_series(raw, tk, field)
        days = {d: px for d, px in _usable_sessions(series)}
        if days:
            return days
    return {}


def _vs_prev_row_from_sessions(
    all_sessions: list[tuple[str, float]],
    close_by_day: dict[str, float],
) -> dict[str, Any] | None:
    sessions = all_sessions[-2:]
    if len(sessions) < 2:
        return None
    (prev_date, prev_vol), (date, vol) = sessions
    if prev_vol <= 0:
        return None
    windows = volume_surge_windows(all_sessions)
    last_close = close_by_day.get(date)
    prev_close = close_by_day.get(prev_date)
    row: dict[str, Any] = {
        "date": date,
        "volume": round(vol),
        "prev_date": prev_date,
        "prev_volume": round(prev_vol),
        "pct_of_prev": round(vol / prev_vol * 100, 1),
        "surge_24h": bool(windows["surge_24h"]),
        "surge_7d": bool(windows["surge_7d"]),
        "max_pct_7d": windows["max_pct_7d"],
    }
    if last_close is not None:
        row["last_close"] = round(float(last_close), 4)
    if prev_close is not None:
        row["prev_close"] = round(float(prev_close), 4)
    signed = volume_delta_signed(last_close, prev_close, vol)
    if signed is not None:
        row["volume_delta_signed"] = signed
        row["volume_delta_method"] = VOLUME_DELTA_METHOD
    row["obv_divergence_flag"] = obv_divergence_flag(all_sessions, close_by_day)
    return row


def _vs_prev_row_from_ohlcv_bars(bars: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """Build a vs-prev row from ``fetch_ticker_ohlcv`` bars (batch miss fallback)."""
    if not bars:
        return None
    sessions: list[tuple[str, float]] = []
    close_by_day: dict[str, float] = {}
    for bar in bars:
        day = str(bar.get("date") or "")[:10]
        if not day:
            continue
        try:
            vol = float(bar.get("volume"))
            close = float(bar.get("close"))
        except (TypeError, ValueError):
            continue
        if vol != vol or vol <= 0 or close != close or close <= 0:
            continue
        sessions.append((day, vol))
        close_by_day[day] = close
    return _vs_prev_row_from_sessions(sessions, close_by_day)


def _vs_prev_row_from_download(raw: Any, tk: str) -> dict[str, Any] | None:
    try:
        all_sessions = _usable_sessions(_extract_volume_series(raw, tk))
    except Exception as exc:  # noqa: BLE001
        logger.debug("volume series %s: %s", tk, exc)
        return None
    return _vs_prev_row_from_sessions(all_sessions, _close_series_by_day(raw, tk))


def fetch_volume_vs_prev_session(
    tickers: list[str] | str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Latest session volume as a share of the previous Nasdaq session, per ticker.

    During an open session the latest bar is partial by design: that is exactly
    the comparison the KPI snapshot shows (traded so far vs. a full prior day).
    """
    tks = _normalize_tickers(tickers)
    now = time.time()
    rows, stale = partition_vs_prev_cache(tks, now=now, force=force)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": dict(rows),
        "error": None,
    }
    if not tks:
        return payload
    if not stale:
        return payload

    try:
        import yfinance as yf
    except ImportError:
        payload["error"] = "yfinance_not_installed"
        return payload

    try:
        raw = yf.download(
            stale,
            period="10d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=True,
            group_by="column",
        )
    except Exception as exc:  # noqa: BLE001 — network flakiness is not fatal
        logger.warning("yf.download daily volume failed: %s", exc)
        payload["error"] = str(exc)[:200]
        raw = None

    if raw is not None and not (hasattr(raw, "empty") and raw.empty):
        for tk in stale:
            row = _vs_prev_row_from_download(raw, tk)
            if not row:
                continue
            row = _coalesce_vs_prev_closes(tk, row)
            _VS_PREV_ROWS[tk] = {"at": now, "row": row}
            rows[tk] = row
    elif payload["error"] is None:
        payload["error"] = "empty"

    need_fallback = [tk for tk in stale if not _vs_prev_row_complete(rows.get(tk))]
    if need_fallback:
        _fill_missing_vs_prev_from_ohlcv(need_fallback, rows, now=now)
    payload["rows"] = rows
    return payload


def _coalesce_vs_prev_closes(tk: str, row: dict[str, Any]) -> dict[str, Any]:
    """Keep last/prev close when a Yahoo reprint omits them (weekend holes)."""
    if _vs_prev_row_complete(row):
        return row
    hit = _VS_PREV_ROWS.get(tk)
    prev = hit.get("row") if isinstance(hit, dict) else None
    if not isinstance(prev, dict):
        return row
    out = dict(row)
    for key in ("last_close", "prev_close"):
        if out.get(key) is not None:
            continue
        try:
            v = float(prev.get(key))
        except (TypeError, ValueError):
            continue
        if v > 0:
            out[key] = round(v, 4)
    return out


def _fill_missing_vs_prev_from_ohlcv(
    missing: list[str],
    rows: dict[str, Any],
    *,
    now: float,
) -> None:
    """Per-name OHLCV when the batch download skipped Close/Volume."""
    for tk in missing[:_VS_PREV_FALLBACK_MAX]:
        try:
            bars = fetch_ticker_ohlcv(tk, period="10d", interval="1d", max_retries=1)
        except Exception as exc:  # noqa: BLE001
            logger.debug("ohlcv fallback %s: %s", tk, exc)
            continue
        row = _vs_prev_row_from_ohlcv_bars(bars)
        if not row:
            continue
        row = _coalesce_vs_prev_closes(tk, row)
        _VS_PREV_ROWS[tk] = {"at": now, "row": row}
        rows[tk] = row
