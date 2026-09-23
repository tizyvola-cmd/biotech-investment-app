"""
Catalyst table — Unusual Options Activity (Framework v2 signal 6).

Display only — not a Soft BUY/SELL input.

Formulas (brief):
  OptionsVolRatio(strike,t) = Volume_today(strike) / AvgVolume_20d(strike)
  UOA_Flag = TRUE if OptionsVolRatio > 5
                  AND Volume_today(strike) > OpenInterest_yesterday(strike)

Yahoo exposes today's volume and OI, not a ready-made 20d avg. We therefore
persist a daily per-strike volume (+ OI) snapshot ourselves. After ~20 trading
sessions the trailing mean becomes AvgVolume_20d and UOA can fire. Until then
status is ``building_history`` (UI "—", with X/20 in the tip).

Sweep-order detection needs a multi-exchange tape → deferred to v3.
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Sequence

logger = logging.getLogger("supernova.catalyst_uoa")

_CACHE_DIR = Path("data") / "cache" / "catalyst_uoa"
_VOL_HIST_DIR = _CACHE_DIR / "vol_history"
_TTL_S = 4 * 60 * 60
_MAX_TICKERS = 24
_VOL_RATIO_MIN = 5.0
_HISTORY_NEEDED = 20
_HISTORY_KEEP = 40
_STRIKE_MIN_OBS = 5  # min prior days a strike must appear before its avg counts


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


def options_vol_ratio(volume_today: Any, avg_volume_20d: Any) -> float | None:
    """Volume_today / AvgVolume_20d. None if either input is missing."""
    vol = _finite(volume_today)
    avg = _finite(avg_volume_20d)
    if vol is None or avg is None or avg <= 0 or vol < 0:
        return None
    return round(vol / avg, 3)


def uoa_flag(
    vol_ratio: Any,
    volume_today: Any,
    open_interest_prior: Any,
    *,
    ratio_min: float = _VOL_RATIO_MIN,
) -> bool | None:
    """
    TRUE only when ratio and Volume > prior OI can both be evaluated and hold.
    None when required inputs are missing (never invent avg vol = 0).
    """
    ratio = _finite(vol_ratio)
    vol = _finite(volume_today)
    oi = _finite(open_interest_prior)
    if ratio is None or vol is None or oi is None:
        return None
    return bool(ratio > ratio_min and vol > oi)


def _opt_float(row: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        v = _finite(row.get(k))
        if v is not None:
            return v
    return None


def classify_uoa_from_chain(
    calls: Sequence[dict[str, Any]],
    puts: Sequence[dict[str, Any]],
    *,
    prior_oi_by_strike: dict[str, dict[str, float]] | None = None,
    avg_vol_by_strike: dict[str, dict[str, float]] | None = None,
) -> dict[str, Any]:
    """
    Scan call/put rows for the strongest UOA hit.

    ``avg_vol_by_strike``: {"C": {strike: avg20}, "P": {...}} — required for ratio.
    ``prior_oi_by_strike``: same shape for yesterday OI.
    Without avg vol feed → status "no_avg_vol_feed", uoa_flag None.
    """
    prior = prior_oi_by_strike or {}
    avgs = avg_vol_by_strike or {}
    has_avg_feed = bool(avgs.get("C") or avgs.get("P"))

    best: dict[str, Any] | None = None

    def _scan(side: str, rows: Sequence[dict[str, Any]]) -> None:
        nonlocal best
        side_avg = avgs.get(side) or {}
        side_oi = prior.get(side) or {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            strike = _opt_float(row, "strike")
            vol = _opt_float(row, "volume")
            oi = _opt_float(row, "openInterest", "open_interest")
            if strike is None or vol is None:
                continue
            key = f"{strike:g}"
            avg = side_avg.get(key)
            # Prefer cached prior OI; fall back to today's OI only as "prior unknown".
            prior_oi = side_oi.get(key)
            ratio = options_vol_ratio(vol, avg) if avg is not None else None
            flag = uoa_flag(ratio, vol, prior_oi)
            if flag is not True:
                continue
            premium = None
            last = _opt_float(row, "lastPrice", "last_price", "last")
            if last is not None:
                premium = round(last * vol * 100.0, 2)
            cand = {
                "side": "call" if side == "C" else "put",
                "strike": strike,
                "volume": vol,
                "open_interest": oi,
                "prior_oi": prior_oi,
                "vol_ratio": ratio,
                "premium": premium,
            }
            if best is None or (cand["vol_ratio"] or 0) > (best.get("vol_ratio") or 0):
                best = cand

    if not has_avg_feed:
        return {
            "uoa_flag": None,
            "side": None,
            "strike": None,
            "vol_ratio": None,
            "volume": None,
            "premium": None,
            "status": "no_avg_vol_feed",
            "note": "yahoo_chain_lacks_20d_avg_volume",
        }

    _scan("C", calls)
    _scan("P", puts)

    if not best:
        return {
            "uoa_flag": False,
            "side": None,
            "strike": None,
            "vol_ratio": None,
            "volume": None,
            "premium": None,
            "status": "none",
        }
    return {
        "uoa_flag": True,
        "side": best["side"],
        "strike": best["strike"],
        "vol_ratio": best["vol_ratio"],
        "volume": best["volume"],
        "premium": best["premium"],
        "status": "ok",
    }


def build_uoa_row(
    ticker: str,
    *,
    calls: Sequence[dict[str, Any]] | None = None,
    puts: Sequence[dict[str, Any]] | None = None,
    prior_oi_by_strike: dict[str, dict[str, float]] | None = None,
    avg_vol_by_strike: dict[str, dict[str, float]] | None = None,
    history_days: int = 0,
    history_needed: int = _HISTORY_NEEDED,
) -> dict[str, Any]:
    classified = classify_uoa_from_chain(
        calls or [],
        puts or [],
        prior_oi_by_strike=prior_oi_by_strike,
        avg_vol_by_strike=avg_vol_by_strike,
    )
    if classified.get("status") == "no_avg_vol_feed" and history_days < history_needed:
        classified["status"] = "building_history"
        classified["note"] = "collecting_daily_strike_volume"
    return {
        "ticker": ticker.strip().upper(),
        **classified,
        "history_days": int(history_days),
        "history_needed": int(history_needed),
        "sweep_flag": None,  # deferred to v3 — needs multi-exchange tape
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


def _rows_from_yf_frame(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    try:
        return [r for r in frame.to_dict("records") if isinstance(r, dict)]
    except Exception:
        return []


def _fetch_chain(ticker: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        import yfinance as yf

        t = yf.Ticker(ticker)
        exps = list(t.options or [])
        if not exps:
            return [], []
        chain = t.option_chain(exps[0])
        return (
            _rows_from_yf_frame(getattr(chain, "calls", None)),
            _rows_from_yf_frame(getattr(chain, "puts", None)),
        )
    except Exception as exc:
        logger.warning("uoa chain %s: %s", ticker, exc)
        return [], []


def _snapshot_oi(calls: list[dict[str, Any]], puts: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {"C": {}, "P": {}}
    for side, rows in (("C", calls), ("P", puts)):
        for row in rows:
            strike = _opt_float(row, "strike")
            oi = _opt_float(row, "openInterest", "open_interest")
            if strike is None or oi is None:
                continue
            out[side][f"{strike:g}"] = float(oi)
    return out


def _snapshot_vol(calls: list[dict[str, Any]], puts: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {"C": {}, "P": {}}
    for side, rows in (("C", calls), ("P", puts)):
        for row in rows:
            strike = _opt_float(row, "strike")
            vol = _opt_float(row, "volume")
            if strike is None or vol is None:
                continue
            out[side][f"{strike:g}"] = float(vol)
    return out


def _vol_hist_path(ticker: str) -> Path:
    return _VOL_HIST_DIR / f"{ticker.strip().upper()}.json"


def _load_vol_history(ticker: str) -> dict[str, Any]:
    doc = _read_json(_vol_hist_path(ticker)) or {}
    prints = [p for p in (doc.get("prints") or []) if isinstance(p, dict) and p.get("asof")]
    prints.sort(key=lambda p: str(p.get("asof")))
    return {"prints": prints}


def append_vol_history_day(
    ticker: str,
    *,
    asof: str,
    vol: dict[str, dict[str, float]],
    oi: dict[str, dict[str, float]],
) -> dict[str, Any]:
    """
    Upsert one calendar day's per-strike volume + OI snapshot.
    Idempotent for the same ``asof`` (replaces that day).
    """
    day = str(asof)[:10]
    hist = _load_vol_history(ticker)
    prints = [p for p in hist["prints"] if str(p.get("asof"))[:10] != day]
    prints.append(
        {
            "asof": day,
            "C": {k: float(v) for k, v in (vol.get("C") or {}).items()},
            "P": {k: float(v) for k, v in (vol.get("P") or {}).items()},
            "oi_C": {k: float(v) for k, v in (oi.get("C") or {}).items()},
            "oi_P": {k: float(v) for k, v in (oi.get("P") or {}).items()},
        }
    )
    prints.sort(key=lambda p: str(p.get("asof")))
    prints = prints[-_HISTORY_KEEP:]
    out = {"prints": prints, "updated_at": _now_iso()}
    _write_json(_vol_hist_path(ticker), out)
    return out


def avg_vol_from_history(
    hist: dict[str, Any] | None,
    *,
    asof: str | None = None,
    window: int = _HISTORY_NEEDED,
    min_obs: int = _STRIKE_MIN_OBS,
) -> dict[str, Any]:
    """
    Trailing mean volume per strike from prior sessions (excludes ``asof`` day).

    ``history_days`` counts all stored sessions (incl. today) for UI progress.
    Ready only when there are ``window`` prior sessions and enough strike obs.
    """
    prints = [p for p in ((hist or {}).get("prints") or []) if isinstance(p, dict)]
    day = str(asof or "")[:10] or None
    priors = [p for p in prints if not day or str(p.get("asof"))[:10] < day]
    priors = priors[-int(window) :]
    history_days = len(prints)  # include today so tooltip starts at 1/20
    prior_count = len(priors)
    avgs: dict[str, dict[str, float]] = {"C": {}, "P": {}}
    prior_oi: dict[str, dict[str, float]] = {"C": {}, "P": {}}

    if priors:
        last = priors[-1]
        prior_oi["C"] = {
            str(k): float(v)
            for k, v in (last.get("oi_C") or {}).items()
            if _finite(v) is not None
        }
        prior_oi["P"] = {
            str(k): float(v)
            for k, v in (last.get("oi_P") or {}).items()
            if _finite(v) is not None
        }

    if prior_count < window:
        return {
            "avg_vol_by_strike": None,
            "prior_oi_by_strike": prior_oi if priors else None,
            "history_days": history_days,
            "ready": False,
        }

    for side, key in (("C", "C"), ("P", "P")):
        sums: dict[str, float] = {}
        counts: dict[str, int] = {}
        for p in priors:
            bucket = p.get(key) if isinstance(p.get(key), dict) else {}
            for strike, vol in bucket.items():
                n = _finite(vol)
                if n is None:
                    continue
                sk = str(strike)
                sums[sk] = sums.get(sk, 0.0) + float(n)
                counts[sk] = counts.get(sk, 0) + 1
        for sk, total in sums.items():
            obs = counts.get(sk, 0)
            if obs < min_obs:
                continue
            avgs[side][sk] = round(total / obs, 4)

    has_avg = bool(avgs["C"] or avgs["P"])
    return {
        "avg_vol_by_strike": avgs if has_avg else None,
        "prior_oi_by_strike": prior_oi,
        "history_days": history_days,
        "ready": has_avg,
    }


def _history_covers_today(hist: dict[str, Any], asof: str) -> bool:
    day = str(asof)[:10]
    return any(str(p.get("asof"))[:10] == day for p in (hist.get("prints") or []) if isinstance(p, dict))


def fetch_catalyst_uoa(
    tickers: str | list[str] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    wanted = parse_tickers(tickers)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "note": "uoa_builds_20d_avg_from_daily_yahoo_snapshots",
    }
    if not wanted:
        payload["error"] = "empty_tickers"
        return payload

    now = time.time()
    asof = date.today().isoformat()
    for tk in wanted:
        path = _cache_path(tk)
        cached = _read_json(path)
        hist = _load_vol_history(tk)
        need_hist = not _history_covers_today(hist, asof)
        fresh = cached is not None and path.is_file() and (now - path.stat().st_mtime) < _TTL_S
        if fresh and not force and not need_hist:
            payload["rows"][tk] = cached
            continue
        try:
            calls, puts = _fetch_chain(tk)
            vol_snap = _snapshot_vol(calls, puts)
            oi_snap = _snapshot_oi(calls, puts)
            if need_hist or force:
                hist = append_vol_history_day(tk, asof=asof, vol=vol_snap, oi=oi_snap)
            # Legacy oi_prior file kept as backup mirror of latest OI.
            prior_path = _CACHE_DIR / "oi_prior" / f"{tk}.json"
            _write_json(prior_path, {"oi": oi_snap, "asof": asof})

            derived = avg_vol_from_history(hist, asof=asof)
            row = build_uoa_row(
                tk,
                calls=calls,
                puts=puts,
                prior_oi_by_strike=derived.get("prior_oi_by_strike"),
                avg_vol_by_strike=derived.get("avg_vol_by_strike"),
                history_days=int(derived.get("history_days") or 0),
                history_needed=_HISTORY_NEEDED,
            )
        except Exception as exc:
            logger.warning("uoa fetch failed %s: %s", tk, exc)
            if cached:
                payload["rows"][tk] = cached
            continue
        _write_json(path, row)
        payload["rows"][tk] = row
    return payload


def refresh_catalyst_uoa_universe(*, force: bool = False) -> dict[str, Any]:
    tickers: list[str] = []
    try:
        from event_vol_index import upcoming_pairs_from_snapshots

        tickers = parse_tickers([t for t, _ in upcoming_pairs_from_snapshots(10)])
    except Exception as exc:
        logger.warning("uoa universe scan failed: %s", exc)
    return fetch_catalyst_uoa(tickers, force=force)
