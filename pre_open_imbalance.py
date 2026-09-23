"""
Catalyst table — Pre-Open Imbalance (Databento NOII / NYSE Pillar).

Display-only context index — NOT Soft BUY/SELL, NOT Recommendation/Signal.

Brief formulas:
  ImbalanceRatio(t)  = ImbalanceShares(t) / PairedShares(t)
  IndicativeMove_pct = (IndicativeMatchPrice(t) - PriorClose) / PriorClose * 100
  ImbalanceDirection = "Buy" | "Sell" from excess side
  ImbalanceAccelerating = TRUE iff ImbalanceRatio(9:29) > ImbalanceRatio(9:28)
                          in the SAME direction (needs ≥2 snapshots; else direction only)

Do-not (brief):
  - Outside real transmission window → UI "—", never prior-session stale values
  - Route each ticker to the correct venue feed (never assume Nasdaq for all)
  - Do not treat as Soft BUY/SELL / Recommendation gate
  - Do not enable continuous refresh for the full desk until Databento plan/licenses confirmed
  - Do not set ImbalanceAccelerating with fewer than two snapshots
"""
from __future__ import annotations

import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timezone
from typing import Any, Iterable, Sequence
from zoneinfo import ZoneInfo

logger = logging.getLogger("supernova.pre_open_imbalance")

NY_TZ = ZoneInfo("America/New_York")

# Databento datasets — brief: Nasdaq NOII vs NYSE Pillar (do not mix without routing).
DATASET_NASDAQ = "XNAS.ITCH"
DATASET_NYSE = "XNYS.PILLAR"
SCHEMA_IMBALANCE = "imbalance"

# Transmission windows (ET), inclusive start / exclusive end at :30.
NASDAQ_WINDOW_START = dtime(9, 28)
NASDAQ_WINDOW_END = dtime(9, 30)
NYSE_WINDOW_START = dtime(9, 0)
NYSE_WINDOW_END = dtime(9, 30)

# Accelerating compare minutes (brief: 9:28 vs 9:29), both venues.
ACCEL_MINUTE_A = 28
ACCEL_MINUTE_B = 29

_MAX_TICKERS = 32

# Continuous live poll for the whole desk is OFF until plan/licenses are confirmed.
_CONTINUOUS_ENV = "PRE_OPEN_IMBALANCE_CONTINUOUS"
_API_KEY_ENV = "DATABENTO_API_KEY"

# In-process prints for the CURRENT ET session day only. Cleared when the day rolls
# or when outside the window — never returned as stale prior-session values.
_session_day: date | None = None
_session_prints: dict[str, list[dict[str, Any]]] = {}


@dataclass(frozen=True)
class VenueRoute:
    venue: str  # "nasdaq" | "nyse"
    dataset: str
    window_start: dtime
    window_end: dtime


def _finite(v: Any) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def now_et(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(NY_TZ)
    if now.tzinfo is None:
        return now.replace(tzinfo=NY_TZ)
    return now.astimezone(NY_TZ)


def normalize_listing_venue(raw: Any) -> str | None:
    """Map listing labels → 'nasdaq' | 'nyse'. None if unknown (do not guess Nasdaq)."""
    s = str(raw or "").strip().upper()
    if not s:
        return None
    # Common Yahoo / Finnhub / MIC-ish labels
    if s in {"NASDAQ", "XNAS", "NMS", "NGSM", "NGS", "NAS", "NSDQ", "GSM", "NSM"}:
        return "nasdaq"
    if "NASDAQ" in s or s.startswith("XNAS"):
        return "nasdaq"
    if s in {"NYSE", "XNYS", "NYQ", "NYS", "NYSE ARCA", "ARCA", "ARCX", "AMEX", "XASE"}:
        # Primary NYSE Pillar path for listed names; Arca/American still NYSE family
        # but brief names XNYS.PILLAR — route NYSE primary to XNYS; Arca stays nyse family
        # with dataset override below when MIC is ARCX.
        return "nyse"
    if "NYSE" in s or s.startswith("XNYS") or s.startswith("ARCX") or s.startswith("XASE"):
        return "nyse"
    return None


def dataset_for_listing(raw: Any) -> VenueRoute | None:
    s = str(raw or "").strip().upper()
    venue = normalize_listing_venue(s)
    if venue == "nasdaq":
        return VenueRoute("nasdaq", DATASET_NASDAQ, NASDAQ_WINDOW_START, NASDAQ_WINDOW_END)
    if venue == "nyse":
        # Brief: XNYS.PILLAR for NYSE. Arca/American use sibling Pillar IDs when MIC known.
        if "ARCA" in s or s in {"ARCX", "NYSE ARCA"}:
            return VenueRoute("nyse", "ARCX.PILLAR", NYSE_WINDOW_START, NYSE_WINDOW_END)
        if "AMEX" in s or "AMERICAN" in s or s in {"XASE"}:
            return VenueRoute("nyse", "XASE.PILLAR", NYSE_WINDOW_START, NYSE_WINDOW_END)
        return VenueRoute("nyse", DATASET_NYSE, NYSE_WINDOW_START, NYSE_WINDOW_END)
    return None


def is_in_transmission_window(
    route: VenueRoute,
    now: datetime | None = None,
) -> bool:
    """True only inside the live NOII / Pillar dissemination window for that venue."""
    et = now_et(now)
    if et.weekday() >= 5:
        return False
    t = et.timetz().replace(tzinfo=None)
    return route.window_start <= t < route.window_end


def imbalance_ratio(imbalance_shares: Any, paired_shares: Any) -> float | None:
    """ImbalanceRatio = ImbalanceShares / PairedShares. None if paired ≤ 0 or missing."""
    imb = _finite(imbalance_shares)
    paired = _finite(paired_shares)
    if imb is None or paired is None or paired <= 0:
        return None
    return round(abs(imb) / paired, 6)


def indicative_move_pct(indicative_match_price: Any, prior_close: Any) -> float | None:
    """(IndicativeMatchPrice − PriorClose) / PriorClose * 100."""
    px = _finite(indicative_match_price)
    close = _finite(prior_close)
    if px is None or close is None or close <= 0:
        return None
    return round((px - close) / close * 100.0, 4)


def imbalance_direction_from_side(side: Any) -> str | None:
    """
    Databento / venue side: B = buy imbalance, A = sell (ask) imbalance, N = none.
    Also accepts Buy/Sell strings.
    """
    s = str(side or "").strip().upper()
    if not s or s in {"N", "NONE", "0", "O"}:
        return None
    if s in {"B", "BUY", "BID", "1"}:
        return "Buy"
    if s in {"A", "S", "SELL", "ASK", "2"}:
        return "Sell"
    return None


def imbalance_accelerating(
    snapshots: Sequence[dict[str, Any]],
    *,
    minute_a: int = ACCEL_MINUTE_A,
    minute_b: int = ACCEL_MINUTE_B,
) -> bool | None:
    """
    TRUE if ImbalanceRatio(9:29) > ImbalanceRatio(9:28) in the same direction.
    None when fewer than two usable snapshots (show direction only).
    """
    by_minute: dict[int, dict[str, Any]] = {}
    for snap in snapshots:
        et = snap.get("et")
        if not isinstance(et, datetime):
            continue
        if et.hour != 9:
            continue
        ratio = _finite(snap.get("imbalance_ratio"))
        direction = snap.get("direction")
        if ratio is None or direction not in ("Buy", "Sell"):
            continue
        # Keep the latest print inside that minute.
        prev = by_minute.get(et.minute)
        if prev is None or et >= prev["et"]:
            by_minute[et.minute] = {
                "et": et,
                "imbalance_ratio": ratio,
                "direction": direction,
            }

    a = by_minute.get(minute_a)
    b = by_minute.get(minute_b)
    if a is None or b is None:
        # Fall back: any two ordered snapshots in-window with same direction.
        usable = [
            s
            for s in snapshots
            if _finite(s.get("imbalance_ratio")) is not None
            and s.get("direction") in ("Buy", "Sell")
            and isinstance(s.get("et"), datetime)
        ]
        if len(usable) < 2:
            return None
        usable = sorted(usable, key=lambda s: s["et"])
        first, last = usable[0], usable[-1]
        if first["direction"] != last["direction"]:
            return False
        r0 = float(first["imbalance_ratio"])
        r1 = float(last["imbalance_ratio"])
        return bool(r1 > r0)

    if a["direction"] != b["direction"]:
        return False
    return bool(float(b["imbalance_ratio"]) > float(a["imbalance_ratio"]))


def blank_row(
    ticker: str,
    *,
    reason: str,
    venue: str | None = None,
    dataset: str | None = None,
    in_window: bool = False,
) -> dict[str, Any]:
    """Empty display row — UI must show '—'. Never fill with prior-session values."""
    return {
        "ticker": ticker.strip().upper(),
        "in_window": in_window,
        "venue": venue,
        "dataset": dataset,
        "imbalance_ratio": None,
        "indicative_move_pct": None,
        "direction": None,
        "imbalance_accelerating": None,
        "imbalance_shares": None,
        "paired_shares": None,
        "indicative_match_price": None,
        "prior_close": None,
        "asof_et": None,
        "snapshot_count": 0,
        "status": reason,
        "error": None,
    }


def build_row_from_snapshots(
    ticker: str,
    snapshots: Sequence[dict[str, Any]],
    *,
    route: VenueRoute,
    prior_close: float | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build one desk row from in-window snapshots. Outside window → blank."""
    tk = ticker.strip().upper()
    if not is_in_transmission_window(route, now):
        return blank_row(
            tk,
            reason="outside_window",
            venue=route.venue,
            dataset=route.dataset,
            in_window=False,
        )
    if not snapshots:
        return blank_row(
            tk,
            reason="no_data",
            venue=route.venue,
            dataset=route.dataset,
            in_window=True,
        )

    # Latest snapshot in window for the badge.
    ordered = sorted(
        (s for s in snapshots if isinstance(s.get("et"), datetime)),
        key=lambda s: s["et"],
    )
    if not ordered:
        return blank_row(
            tk,
            reason="no_data",
            venue=route.venue,
            dataset=route.dataset,
            in_window=True,
        )
    last = ordered[-1]
    direction = last.get("direction")
    ratio = _finite(last.get("imbalance_ratio"))
    imb = _finite(last.get("imbalance_shares"))
    paired = _finite(last.get("paired_shares"))
    match_px = _finite(last.get("indicative_match_price"))
    move = indicative_move_pct(match_px, prior_close)
    accel = imbalance_accelerating(ordered)

    return {
        "ticker": tk,
        "in_window": True,
        "venue": route.venue,
        "dataset": route.dataset,
        "imbalance_ratio": ratio,
        "indicative_move_pct": move,
        "direction": direction if direction in ("Buy", "Sell") else None,
        "imbalance_accelerating": accel,
        "imbalance_shares": imb,
        "paired_shares": paired,
        "indicative_match_price": match_px,
        "prior_close": _finite(prior_close),
        "asof_et": last["et"].isoformat(),
        "snapshot_count": len(ordered),
        "status": "ok" if direction else "no_direction",
        "error": None,
    }


def _reset_session_if_needed(et: datetime) -> None:
    global _session_day, _session_prints
    day = et.date()
    if _session_day != day:
        _session_day = day
        _session_prints = {}


def _purge_outside_window(et: datetime) -> None:
    """Drop all cached prints when the market is outside every transmission window."""
    global _session_prints
    # Keep only while ET is inside the union of Nasdaq+NYSE windows on a weekday.
    if et.weekday() >= 5:
        _session_prints = {}
        return
    t = et.timetz().replace(tzinfo=None)
    in_any = NYSE_WINDOW_START <= t < NYSE_WINDOW_END
    if not in_any:
        _session_prints = {}


def remember_snapshot(ticker: str, snap: dict[str, Any]) -> None:
    """Store a same-session print (tests / live ingest). Cleared outside window."""
    tk = ticker.strip().upper()
    et = snap.get("et")
    if not isinstance(et, datetime):
        return
    et = now_et(et)
    _reset_session_if_needed(et)
    if et.weekday() >= 5:
        return
    t = et.timetz().replace(tzinfo=None)
    if not (NYSE_WINDOW_START <= t < NYSE_WINDOW_END):
        return
    row = {**snap, "et": et}
    bucket = _session_prints.setdefault(tk, [])
    bucket.append(row)
    # Cap memory: keep last ~60 prints per ticker inside the window.
    if len(bucket) > 60:
        del bucket[:-60]


def continuous_refresh_allowed() -> bool:
    """Brief: do not wire continuous desk refresh until plan/licenses are confirmed."""
    return os.environ.get(_CONTINUOUS_ENV, "").strip().lower() in {"1", "true", "yes"}


def databento_api_key() -> str | None:
    key = os.environ.get(_API_KEY_ENV, "").strip()
    return key or None


def _databento_side(rec: Any) -> str | None:
    side = getattr(rec, "side", None)
    if side is None and isinstance(rec, dict):
        side = rec.get("side")
    # Enum-like
    if hasattr(side, "name"):
        side = side.name
    return imbalance_direction_from_side(side)


def _databento_qty(rec: Any, *names: str) -> float | None:
    for name in names:
        if isinstance(rec, dict):
            v = rec.get(name)
        else:
            v = getattr(rec, name, None)
        n = _finite(v)
        if n is not None:
            return n
    return None


def _databento_price(rec: Any, *names: str) -> float | None:
    for name in names:
        if isinstance(rec, dict):
            raw = rec.get(name)
        else:
            raw = getattr(rec, name, None)
        n = _finite(raw)
        if n is None:
            continue
        # Databento fixed-price often scaled by 1e-9; values > 1e6 are almost certainly scaled.
        if n > 1e6:
            n = n * 1e-9
        if n > 0:
            return n
    return None


def _record_to_snapshot(rec: Any, *, et: datetime | None = None) -> dict[str, Any] | None:
    imb = _databento_qty(rec, "total_imbalance_qty", "imbalance_qty", "imbalance_shares")
    paired = _databento_qty(rec, "paired_qty", "paired_shares")
    match_px = _databento_price(
        rec,
        "cont_book_clr_price",
        "auct_interest_clr_price",
        "indicative_match_price",
        "ref_price",
    )
    direction = _databento_side(rec)
    ts = et
    if ts is None:
        raw_ts = getattr(rec, "ts_event", None) or getattr(rec, "ts_recv", None)
        if isinstance(raw_ts, datetime):
            ts = now_et(raw_ts)
        elif isinstance(raw_ts, (int, float)) and raw_ts > 0:
            # nanoseconds since epoch
            sec = raw_ts / 1e9 if raw_ts > 1e15 else float(raw_ts)
            ts = datetime.fromtimestamp(sec, tz=timezone.utc).astimezone(NY_TZ)
    if ts is None:
        ts = now_et()
    ratio = imbalance_ratio(imb, paired)
    if ratio is None and direction is None and match_px is None:
        return None
    return {
        "et": ts,
        "imbalance_shares": imb,
        "paired_shares": paired,
        "imbalance_ratio": ratio,
        "indicative_match_price": match_px,
        "direction": direction,
    }


def _fetch_live_imbalance_once(
    tickers: Sequence[str],
    *,
    dataset: str,
    api_key: str,
    timeout_s: float = 2.5,
) -> dict[str, dict[str, Any]]:
    """
    One-shot live snapshot via Databento Live (schema=imbalance).
    Not a continuous desk poll — caller must not loop this for all tickers
    unless continuous_refresh_allowed().
    """
    try:
        import databento as db  # type: ignore
    except ImportError:
        logger.warning("databento package not installed")
        return {}

    out: dict[str, dict[str, Any]] = {}
    symbols = [t.strip().upper() for t in tickers if t and str(t).strip()]
    if not symbols:
        return out

    client = db.Live(key=api_key)
    client.subscribe(
        dataset=dataset,
        schema=SCHEMA_IMBALANCE,
        symbols=symbols,
        stype_in="raw_symbol",
    )

    deadline = time.monotonic() + timeout_s
    try:
        for rec in client:
            if time.monotonic() > deadline:
                break
            sym = getattr(rec, "symbol", None) or getattr(rec, "raw_symbol", None)
            if not sym:
                continue
            snap = _record_to_snapshot(rec)
            if not snap:
                continue
            tk = str(sym).strip().upper()
            out[tk] = snap
            remember_snapshot(tk, snap)
            if len(out) >= len(symbols):
                # Got at least one print per symbol — enough for a badge refresh.
                break
    finally:
        try:
            client.stop()
        except Exception:
            pass
    return out


def resolve_listing_map(
    tickers: Sequence[str],
    listing_by_ticker: dict[str, Any] | None = None,
) -> dict[str, VenueRoute | None]:
    """Resolve venue per ticker. Unknown → None (blank row; never default to Nasdaq)."""
    listing_by_ticker = listing_by_ticker or {}
    out: dict[str, VenueRoute | None] = {}
    for raw in tickers:
        tk = str(raw or "").strip().upper()
        if not tk:
            continue
        out[tk] = dataset_for_listing(listing_by_ticker.get(tk))
    return out


def fetch_pre_open_imbalance(
    tickers: str | Sequence[str] | None,
    *,
    listing_by_ticker: dict[str, Any] | None = None,
    prior_close_by_ticker: dict[str, Any] | None = None,
    force_live: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Snapshot for Catalyst Pre-Open column.

    Outside transmission windows → empty rows (status=outside_window), never stale.
    Live Databento pull only when force_live and API key present and ticker is in-window.
    Continuous full-desk polling is blocked unless PRE_OPEN_IMBALANCE_CONTINUOUS=1.
    """
    et = now_et(now)
    _reset_session_if_needed(et)
    _purge_outside_window(et)

    if isinstance(tickers, str):
        raw_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    elif tickers is None:
        raw_list = []
    else:
        raw_list = [str(t).strip().upper() for t in tickers if str(t).strip()]

    clean = []
    seen: set[str] = set()
    for tk in raw_list:
        if tk and tk not in seen:
            seen.add(tk)
            clean.append(tk)
    clean = clean[:_MAX_TICKERS]

    prior_close_by_ticker = prior_close_by_ticker or {}
    routes = resolve_listing_map(clean, listing_by_ticker)

    note_parts: list[str] = []
    api_key = databento_api_key()
    if not api_key:
        note_parts.append(f"{_API_KEY_ENV} not set — live Databento disabled.")
    if not continuous_refresh_allowed():
        note_parts.append(
            "Continuous desk refresh disabled (set PRE_OPEN_IMBALANCE_CONTINUOUS=1 "
            "only after confirming Databento plan + Nasdaq TotalView / NYSE Order "
            "Imbalances licenses)."
        )

    # Optional one-shot live fill for tickers currently in-window, grouped by dataset.
    if force_live and api_key:
        by_dataset: dict[str, list[str]] = {}
        for tk, route in routes.items():
            if route is None:
                continue
            if not is_in_transmission_window(route, et):
                continue
            by_dataset.setdefault(route.dataset, []).append(tk)
        for dataset, syms in by_dataset.items():
            try:
                _fetch_live_imbalance_once(syms, dataset=dataset, api_key=api_key)
            except Exception as exc:  # noqa: BLE001 — surface as note, keep blanks
                logger.exception("Databento live imbalance failed for %s", dataset)
                note_parts.append(f"live {dataset}: {exc}")

    rows: dict[str, dict[str, Any]] = {}
    for tk in clean:
        route = routes.get(tk)
        if route is None:
            rows[tk] = blank_row(tk, reason="unknown_listing_venue")
            continue
        if not is_in_transmission_window(route, et):
            rows[tk] = blank_row(
                tk,
                reason="outside_window",
                venue=route.venue,
                dataset=route.dataset,
                in_window=False,
            )
            continue
        snaps = list(_session_prints.get(tk, []))
        # Keep only prints that fall inside THIS venue's window today.
        filtered = []
        for s in snaps:
            s_et = s.get("et")
            if not isinstance(s_et, datetime):
                continue
            s_et = now_et(s_et)
            if s_et.date() != et.date():
                continue
            t = s_et.timetz().replace(tzinfo=None)
            if route.window_start <= t < route.window_end:
                filtered.append({**s, "et": s_et})
        prior = _finite(prior_close_by_ticker.get(tk))
        rows[tk] = build_row_from_snapshots(
            tk,
            filtered,
            route=route,
            prior_close=prior,
            now=et,
        )

    return {
        "updated_at": _now_iso(),
        "asof_et": et.isoformat(),
        "rows": rows,
        "continuous_refresh": continuous_refresh_allowed(),
        "databento_configured": bool(api_key),
        "note": " ".join(note_parts) if note_parts else None,
        "error": None,
    }


def clear_session_cache_for_tests() -> None:
    """Test helper — wipe in-process prints."""
    global _session_day, _session_prints
    _session_day = None
    _session_prints = {}
