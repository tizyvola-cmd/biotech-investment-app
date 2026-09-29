"""
IV run-up / Event Vol Index and call-put skew for approaching catalysts.

Display only — not a Soft BUY/SELL input.
Daily prints live in data/cache/event_vol_index/ so slope is the signal.
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.event_vol")

_CACHE_DIR = Path("data") / "cache" / "event_vol_index"
_TTL_S = 4 * 60 * 60
_HISTORY_MAX = 32
# Match Catalyst desk watch size — Short Δ / Vol already allow ~80 tickers.
_MAX_PAIRS = 80
# Live Yahoo option chains are slow; remaining pairs use disk cache / stale.
# Budget is per *uncached ticker* (same-ticker date variants reuse disk).
_MAX_LIVE = 48
_LIVE_GAP_S = 0.25
_YEAR = 365.25
_TRADING_YEAR = 252.0

_live_lock = threading.Lock()
_last_live_at = 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _pair_key(ticker: str, event_date: str) -> str:
    return f"{ticker.strip().upper()}|{event_date[:10]}"


def _opt_float(row: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(n):
            return n
    return None


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


def parse_pairs(raw: str | list[tuple[str, str]] | None) -> list[tuple[str, str]]:
    if not raw:
        return []
    if isinstance(raw, list):
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for tk, ev in raw:
            t = str(tk).strip().upper()
            d = str(ev).strip()[:10]
            k = _pair_key(t, d)
            if not t or not d or k in seen:
                continue
            seen.add(k)
            out.append((t, d))
        return out[:_MAX_PAIRS]
    parts = str(raw).replace(";", ",").split(",")
    out = []
    seen = set()
    for part in parts:
        if ":" not in part:
            continue
        tk, ev = part.split(":", 1)
        t = tk.strip().upper()
        d = ev.strip()[:10]
        k = _pair_key(t, d)
        if not t or len(d) < 10 or k in seen:
            continue
        seen.add(k)
        out.append((t, d))
    return out[:_MAX_PAIRS]


def pick_expiries(expiries: list[str], event_iso: str) -> tuple[str | None, str | None]:
    """IV_ev = first expiry on/after event; IV_bg = last expiry strictly before event."""
    ev_day = event_iso[:10]
    clean = sorted({str(x)[:10] for x in expiries if str(x)[:10]})
    ev = next((x for x in clean if x >= ev_day), clean[-1] if clean else None)
    bg = next((x for x in reversed(clean) if ev and x < ev_day), None)
    if ev and bg and bg == ev:
        bg = None
    return ev, bg


def _atm_row(rows: list[dict[str, Any]], spot: float) -> dict[str, Any] | None:
    best: tuple[float, dict[str, Any]] | None = None
    for row in rows:
        strike = _opt_float(row, "strike")
        if strike is None:
            continue
        dist = abs(strike - spot)
        if best is None or dist < best[0]:
            best = (dist, row)
    return best[1] if best else None


def _atm_iv(rows: list[dict[str, Any]], spot: float) -> float | None:
    row = _atm_row(rows, spot)
    if not row:
        return None
    return _opt_float(row, "impliedVolatility", "implied_volatility", "iv")


def _nearest_iv(rows: list[dict[str, Any]], target: float) -> float | None:
    best: tuple[float, float] | None = None
    for row in rows:
        strike = _opt_float(row, "strike")
        iv = _opt_float(row, "impliedVolatility", "implied_volatility", "iv")
        if strike is None or iv is None:
            continue
        dist = abs(strike - target)
        if best is None or dist < best[0]:
            best = (dist, iv)
    return best[1] if best else None


def _mid_px(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    bid = _opt_float(row, "bid")
    ask = _opt_float(row, "ask")
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    return _opt_float(row, "lastPrice", "last_price", "last")


def _year_frac(start: date, end: date) -> float:
    days = (end - start).days
    return max(days, 1) / _YEAR


def _slope(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    n = len(values)
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    den = sum((x - mean_x) ** 2 for x in xs)
    if den <= 0:
        return 0.0
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values))
    return num / den


def delta_slope_nd(values: list[float], days: int = 5) -> float | None:
    """
    Brief slope: (v(t) − v(t−days)) / days.
    Needs at least days+1 prints — never interpolate missing history.
    """
    if days < 1 or len(values) < days + 1:
        return None
    a = values[-(days + 1)]
    b = values[-1]
    return (b - a) / float(days)


def accelerating_flag(slope_t: float | None, slope_t5: float | None) -> bool | None:
    """TRUE if the slope itself is rising (IVR_slope(t) > IVR_slope(t−5))."""
    if slope_t is None or slope_t5 is None:
        return None
    return bool(slope_t > slope_t5)


def compute_event_vol_metrics(
    *,
    spot: float,
    asof: date,
    event_iso: str,
    expiry_ev: str | None,
    expiry_bg: str | None,
    calls_ev: list[dict[str, Any]],
    puts_ev: list[dict[str, Any]],
    calls_bg: list[dict[str, Any]],
    puts_bg: list[dict[str, Any]],
) -> dict[str, Any]:
    """Pure metrics from two option chains. Used by tests without Yahoo."""
    iv_call_ev = _atm_iv(calls_ev, spot)
    iv_put_ev = _atm_iv(puts_ev, spot)
    iv_ev = None
    if iv_call_ev is not None and iv_put_ev is not None:
        iv_ev = (iv_call_ev + iv_put_ev) / 2.0
    else:
        iv_ev = iv_call_ev if iv_call_ev is not None else iv_put_ev

    iv_call_bg = _atm_iv(calls_bg, spot) if calls_bg else None
    iv_put_bg = _atm_iv(puts_bg, spot) if puts_bg else None
    iv_bg = None
    if iv_call_bg is not None and iv_put_bg is not None:
        iv_bg = (iv_call_bg + iv_put_bg) / 2.0
    else:
        iv_bg = iv_call_bg if iv_call_bg is not None else iv_put_bg

    ivr = (iv_ev / iv_bg) if iv_ev is not None and iv_bg and iv_bg > 1e-9 else None
    spread = (iv_ev - iv_bg) if iv_ev is not None and iv_bg is not None else None

    em_straddle = None
    call_px = _mid_px(_atm_row(calls_ev, spot))
    put_px = _mid_px(_atm_row(puts_ev, spot))
    if call_px is not None and put_px is not None and spot > 0:
        em_straddle = (call_px + put_px) / spot

    em_var = None
    try:
        ev_d = date.fromisoformat(expiry_ev[:10]) if expiry_ev else None
        event_d = date.fromisoformat(event_iso[:10])
    except ValueError:
        ev_d = None
        event_d = None
    if iv_ev is not None and iv_bg is not None and ev_d is not None:
        t_ev = _year_frac(asof, ev_d)
        sigma = iv_ev * iv_ev * t_ev - iv_bg * iv_bg * max(t_ev - 1.0 / _TRADING_YEAR, 0.0)
        if sigma > 0:
            em_var = math.sqrt(sigma)

    iv_call_otm = _nearest_iv(calls_ev, spot * 1.10)
    iv_put_otm = _nearest_iv(puts_ev, spot * 0.90)
    rr10 = (
        iv_call_otm - iv_put_otm
        if iv_call_otm is not None and iv_put_otm is not None
        else None
    )
    skew_cboe = (
        iv_put_otm - iv_call_otm
        if iv_call_otm is not None and iv_put_otm is not None
        else None
    )
    skew_ratio = (
        iv_call_otm / iv_put_otm
        if iv_call_otm is not None and iv_put_otm is not None and iv_put_otm > 1e-9
        else None
    )

    call_vol = sum(_opt_float(r, "volume") or 0.0 for r in calls_ev)
    put_vol = sum(_opt_float(r, "volume") or 0.0 for r in puts_ev)
    call_oi = sum(_opt_float(r, "openInterest", "open_interest") or 0.0 for r in calls_ev)
    put_oi = sum(_opt_float(r, "openInterest", "open_interest") or 0.0 for r in puts_ev)
    pcr_vol = (put_vol / call_vol) if call_vol > 0 else None
    pcr_oi = (put_oi / call_oi) if call_oi > 0 else None

    return {
        "spot": round(spot, 4),
        "event_date": event_iso[:10],
        "asof": asof.isoformat(),
        "expiry_ev": expiry_ev,
        "expiry_bg": expiry_bg,
        "iv_ev": round(iv_ev, 4) if iv_ev is not None else None,
        "iv_bg": round(iv_bg, 4) if iv_bg is not None else None,
        "ivr": round(ivr, 3) if ivr is not None else None,
        "spread": round(spread, 4) if spread is not None else None,
        "em_straddle": round(em_straddle, 4) if em_straddle is not None else None,
        "em_event": round(em_var, 4) if em_var is not None else None,
        "rr10": round(rr10, 4) if rr10 is not None else None,
        "skew_cboe": round(skew_cboe, 4) if skew_cboe is not None else None,
        "skew_ratio": round(skew_ratio, 3) if skew_ratio is not None else None,
        "pcr_vol": round(pcr_vol, 3) if pcr_vol is not None else None,
        "pcr_oi": round(pcr_oi, 3) if pcr_oi is not None else None,
        "days_to_event": (event_d - asof).days if event_d else None,
    }


def _rows_from_yf_frame(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    try:
        records = frame.to_dict("records")
    except Exception:
        return []
    return [r for r in records if isinstance(r, dict)]


def _fetch_chain(ticker: str) -> dict[str, Any]:
    """Yahoo option chain + spot. Isolated for tests."""
    tk = ticker.upper()
    try:
        import yfinance as yf

        t = yf.Ticker(tk)
        exps = [str(x)[:10] for x in (t.options or [])]
        spot = None
        try:
            info = t.fast_info
            spot = float(getattr(info, "last_price", None) or getattr(info, "lastPrice", None) or 0) or None
        except Exception:
            spot = None
        if spot is None:
            try:
                hist = t.history(period="5d")
                if hist is not None and not hist.empty:
                    spot = float(hist["Close"].iloc[-1])
            except Exception:
                spot = None
        return {"expiries": exps, "spot": spot, "ticker": tk, "yf": t}
    except Exception as exc:
        logger.warning("event-vol %s chain list failed: %s", tk, exc)
        return {"expiries": [], "spot": None, "ticker": tk, "yf": None}


def _fetch_expiry_sides(yf_ticker: Any, expiry: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if yf_ticker is None or not expiry:
        return [], []
    try:
        chain = yf_ticker.option_chain(expiry)
    except Exception as exc:
        logger.warning("event-vol expiry %s failed: %s", expiry, exc)
        return [], []
    return (
        _rows_from_yf_frame(getattr(chain, "calls", None)),
        _rows_from_yf_frame(getattr(chain, "puts", None)),
    )


def _history_path(key: str) -> Path:
    safe = key.replace("|", "_").replace("/", "-")
    return _CACHE_DIR / "history" / f"{safe}.json"


def _cache_path(key: str) -> Path:
    safe = key.replace("|", "_").replace("/", "-")
    return _CACHE_DIR / f"{safe}.json"


def _row_has_print(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    return any(
        row.get(k) is not None
        for k in ("ivr", "em_straddle", "em_event", "rr10", "pcr_vol", "skew_ratio")
    )


def _nearest_cached_for_ticker(ticker: str, event_date: str) -> dict[str, Any] | None:
    """Reuse any disk print for the same ticker when the exact pair is missing.

    Catalyst desk rows often change eventDate while Friday's hot-zone cache is
    keyed to a nearby date — Short Δ is ticker-keyed so it stays full; Expect/
    Skew must do the same across pair dates.
    """
    tk = ticker.strip().upper()
    if not tk or not _CACHE_DIR.is_dir():
        return None
    day = str(event_date or "")[:10]
    target_ms: float | None = None
    if len(day) == 10:
        try:
            target_ms = date.fromisoformat(day).toordinal()
        except ValueError:
            target_ms = None
    best: dict[str, Any] | None = None
    best_dist = float("inf")
    prefix = f"{tk}_"
    for path in _CACHE_DIR.glob(f"{tk}_*.json"):
        name = path.name
        if not name.startswith(prefix) or name.endswith(".tmp"):
            continue
        # ALMS_2026-10-01.json → 2026-10-01
        stem = path.stem
        row_day = stem[len(prefix) :][:10]
        doc = _read_json(path)
        if not _row_has_print(doc):
            continue
        dist = float("inf")
        if target_ms is not None and len(row_day) == 10:
            try:
                dist = abs(date.fromisoformat(row_day).toordinal() - target_ms)
            except ValueError:
                dist = float("inf")
        if dist < best_dist:
            best_dist = dist
            best = dict(doc)
            best["event_date"] = day or row_day
            best["ticker"] = tk
            best["stale"] = True
            best["reused_from"] = f"{tk}|{row_day}"
    return best


def _apply_history(row: dict[str, Any], key: str) -> dict[str, Any]:
    hist = _read_json(_history_path(key)) or {}
    prints = [p for p in (hist.get("prints") or []) if isinstance(p, dict)]
    ivrs = [float(p["ivr"]) for p in prints if p.get("ivr") is not None]
    ems = [
        float(p["em_straddle"])
        for p in prints
        if p.get("em_straddle") is not None
    ]
    spreads = [float(p["spread"]) for p in prints if p.get("spread") is not None]
    rrs = [float(p["rr10"]) for p in prints if p.get("rr10") is not None]
    pcrs = [float(p["pcr_vol"]) for p in prints if p.get("pcr_vol") is not None]
    prev_spread = spreads[-2] if len(spreads) >= 2 else None
    d_spread = None
    if row.get("spread") is not None and prev_spread is not None:
        d_spread = float(row["spread"]) - prev_spread
    row["d_spread"] = round(d_spread, 4) if d_spread is not None else None
    # Regression slope (existing UI) + brief 5-day delta slope (signal 4).
    row["ivr_slope"] = round(_slope(ivrs[-8:]), 4) if len(ivrs) >= 2 else None
    row["em_slope"] = round(_slope(ems[-8:]), 4) if len(ems) >= 2 else None
    ivr_d5 = delta_slope_nd(ivrs, 5)
    em_d5 = delta_slope_nd(ems, 5)
    row["ivr_slope_5d"] = round(ivr_d5, 4) if ivr_d5 is not None else None
    row["em_slope_5d"] = round(em_d5, 4) if em_d5 is not None else None
    # Acceleration needs slope(t) and slope(t−5) → at least 11 prints.
    ivr_d5_prev = delta_slope_nd(ivrs[:-5], 5) if len(ivrs) >= 11 else None
    em_d5_prev = delta_slope_nd(ems[:-5], 5) if len(ems) >= 11 else None
    row["ivr_accelerating"] = accelerating_flag(
        row.get("ivr_slope_5d"),
        round(ivr_d5_prev, 4) if ivr_d5_prev is not None else None,
    )
    row["em_accelerating"] = accelerating_flag(
        row.get("em_slope_5d"),
        round(em_d5_prev, 4) if em_d5_prev is not None else None,
    )
    row["rr_slope"] = round(_slope(rrs[-8:]), 4) if len(rrs) >= 2 else None
    row["pcr_vol_slope"] = round(_slope(pcrs[-8:]), 4) if len(pcrs) >= 2 else None
    # Last 15 IVR prints for sparkline (UI) — missing stays omitted, no fill.
    row["ivr_series"] = [round(v, 4) for v in ivrs[-15:]]
    row["em_series"] = [round(v, 4) for v in ems[-15:]]
    row["prints"] = len(prints)
    return row


def _persist(key: str, row: dict[str, Any]) -> dict[str, Any]:
    stored = dict(row)
    stored["updated_at"] = _now_iso()
    hist_path = _history_path(key)
    hist = _read_json(hist_path) or {}
    prints = [p for p in (hist.get("prints") or []) if isinstance(p, dict)]
    day = stored.get("asof")
    prints = [p for p in prints if p.get("asof") != day]
    prints.append(
        {
            "asof": day,
            "ivr": stored.get("ivr"),
            "spread": stored.get("spread"),
            "rr10": stored.get("rr10"),
            "pcr_vol": stored.get("pcr_vol"),
            "em_straddle": stored.get("em_straddle"),
        }
    )
    prints = prints[-_HISTORY_MAX:]
    _write_json(hist_path, {"prints": prints})
    stored = _apply_history(stored, key)
    _write_json(_cache_path(key), stored)
    return stored


def _empty_row(
    ticker: str,
    event_date: str,
    *,
    stale: bool = True,
    empty_reason: str = "not_loaded",
) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "event_date": event_date,
        "ivr": None,
        "spread": None,
        "d_spread": None,
        "ivr_slope": None,
        "ivr_slope_5d": None,
        "ivr_accelerating": None,
        "em_straddle": None,
        "em_event": None,
        "em_slope": None,
        "em_slope_5d": None,
        "em_accelerating": None,
        "ivr_series": [],
        "em_series": [],
        "rr10": None,
        "skew_cboe": None,
        "skew_ratio": None,
        "rr_slope": None,
        "pcr_vol": None,
        "pcr_oi": None,
        "pcr_vol_slope": None,
        "stale": stale,
        "empty_reason": empty_reason,
    }


def _fetch_one_live(ticker: str, event_date: str) -> dict[str, Any] | None:
    global _last_live_at
    with _live_lock:
        gap = _LIVE_GAP_S - (time.time() - _last_live_at)
        if gap > 0:
            time.sleep(gap)
        try:
            payload = _fetch_chain(ticker)
        finally:
            _last_live_at = time.time()
    spot = payload.get("spot")
    exps = payload.get("expiries") or []
    if not spot or not exps:
        return None
    try:
        spot_f = float(spot)
    except (TypeError, ValueError):
        return None
    ev, bg = pick_expiries(exps, event_date)
    yf_t = payload.get("yf")
    calls_ev, puts_ev = _fetch_expiry_sides(yf_t, ev or "")
    calls_bg, puts_bg = _fetch_expiry_sides(yf_t, bg or "") if bg else ([], [])
    row = compute_event_vol_metrics(
        spot=spot_f,
        asof=date.today(),
        event_iso=event_date,
        expiry_ev=ev,
        expiry_bg=bg,
        calls_ev=calls_ev,
        puts_ev=puts_ev,
        calls_bg=calls_bg,
        puts_bg=puts_bg,
    )
    row["ticker"] = ticker
    row["stale"] = False
    if row.get("ivr") is None and row.get("em_straddle") is None and row.get("rr10") is None:
        return None
    return row


def upcoming_pairs_from_snapshots(horizon_days: int = 10) -> list[tuple[str, str]]:
    """Guidance + FDA + Simulation CD inside the rolling horizon."""
    today = date.today()
    end = today + timedelta(days=horizon_days)
    pairs: list[tuple[str, str]] = []

    def _add(tk: str, iso: str) -> None:
        t = tk.strip().upper()
        d = iso[:10]
        if not t or len(d) < 10:
            return
        try:
            day = date.fromisoformat(d)
        except ValueError:
            return
        if today <= day <= end:
            pairs.append((t, d))

    gpath = Path("data") / "guidance_calendar_snapshot.json"
    gdoc = _read_json(gpath)
    for ev in (gdoc.get("events") if gdoc else None) or []:
        if not isinstance(ev, dict):
            continue
        _add(str(ev.get("ticker") or ""), str(ev.get("window_start") or ev.get("window_end") or ""))

    fpath = Path("data") / "fda_adcom_calendar_snapshot.json"
    fdoc = _read_json(fpath)
    for row in (fdoc.get("rows") if fdoc else None) or []:
        if not isinstance(row, dict):
            continue
        _add(str(row.get("ticker") or ""), str(row.get("date") or ""))

    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        sdoc = _read_json(Path(SIMULATION_SHEET_SNAPSHOT_JSON))
        for row in (sdoc.get("rows") if sdoc else None) or []:
            if not isinstance(row, dict):
                continue
            raw = str(row.get("Completion Date") or row.get("completion_date") or "")
            iso = raw
            if "/" in raw:
                try:
                    d, m, y = raw.split("/")[:3]
                    iso = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                except (ValueError, TypeError):
                    continue
            _add(str(row.get("Ticker") or row.get("ticker") or ""), iso)
    except Exception:
        pass

    return parse_pairs(pairs)


def fetch_event_vol_index(
    pairs: str | list[tuple[str, str]] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    wanted = parse_pairs(pairs) if pairs else upcoming_pairs_from_snapshots(10)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "method": None,
    }
    if not wanted:
        payload["error"] = "empty_pairs"
        return payload

    live_used = 0
    cache_hits = 0
    live_ok = 0
    now = time.time()
    # One live Yahoo pull per ticker per request — date variants share the print.
    live_tickers_done: set[str] = set()
    for tk, ev in wanted:
        key = _pair_key(tk, ev)
        cache_path = _cache_path(key)
        cached = _read_json(cache_path)
        fresh = (
            cached is not None
            and cache_path.is_file()
            and now - cache_path.stat().st_mtime < _TTL_S
            and _row_has_print(cached)
        )
        if fresh and not force:
            payload["rows"][key] = _apply_history(dict(cached), key)
            cache_hits += 1
            continue

        reused = None if _row_has_print(cached) else _nearest_cached_for_ticker(tk, ev)
        soft = cached if _row_has_print(cached) else reused

        # Disk print (exact or nearest same-ticker) fills the cell without burning
        # live budget — save Yahoo pulls for tickers that have never been printed.
        if soft is not None and not force:
            soft = dict(soft)
            soft["event_date"] = ev[:10]
            soft["stale"] = True
            payload["rows"][key] = _apply_history(soft, key)
            cache_hits += 1
            continue

        if live_used >= _MAX_LIVE or tk in live_tickers_done:
            payload["rows"][key] = _empty_row(tk, ev, empty_reason="not_loaded")
            continue

        live_used += 1
        live_tickers_done.add(tk)
        try:
            row = _fetch_one_live(tk, ev)
        except Exception as exc:
            logger.warning("event-vol %s %s: %s", tk, ev, exc)
            row = None
        if row:
            payload["rows"][key] = _persist(key, row)
            live_ok += 1
        else:
            payload["rows"][key] = _empty_row(tk, ev, empty_reason="no_options")

    if live_ok and cache_hits:
        payload["method"] = "yahoo+cache"
    elif live_ok:
        payload["method"] = "yahoo"
    elif cache_hits:
        payload["method"] = "cache"
    else:
        payload["method"] = "stale"
    return payload


def refresh_event_vol_universe(*, force: bool = False, horizon_days: int = 60) -> dict[str, Any]:
    pairs = upcoming_pairs_from_snapshots(horizon_days)
    return fetch_event_vol_index(pairs, force=force)
