"""
Catalyst table — Pre-Mkt Conviction (FREE proxy of opening pressure).

NOT the official Pre-Open Imbalance (Databento NOII / NYSE Pillar).
This index uses executed pre-market trades (4:00–9:30 ET), which are public
prints — not exchange auction order-queue data. Display-only context index;
NOT Soft BUY/SELL / Recommendation.

Brief formulas:
  PreMktPriceChange_pct = (PreMktLastPrice - PriorClose) / PriorClose * 100
  PreMktVolRatio        = PreMktVolume(today) / PreMktVolume_avg(20d)
  PreMktConviction:
    "together_up"   if price>0 and vol_ratio>1.5
    "together_down" if price<0 and vol_ratio>1.5
    "diverge"       if price moves but vol_ratio<=1.5
    None / "—"      if no pre-market trades that day

  ConvictionConfirmed = TRUE only when Search Buzz same-day delta exists AND
                        points the same way as together ↑/↓.

Do-not (brief):
  - Never label this as order imbalance / NOII
  - No new paid dependency (Yahoo Finance free chart / yfinance only)
  - No ConvictionConfirmed without same-day Search Buzz
  - Distinct from pre_open_imbalance.py (paid official feed)
  - Delay must stay ≤15 min (Yahoo live chart; no slow delayed vendor swap)
"""
from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, time as dtime, timezone
from typing import Any, Sequence
from zoneinfo import ZoneInfo

logger = logging.getLogger("supernova.pre_mkt_conviction")

NY_TZ = ZoneInfo("America/New_York")

PREMKT_START = dtime(4, 0)
PREMKT_END = dtime(9, 30)  # exclusive of RTH open
VOL_RATIO_TOGETHER = 1.5
VOL_AVG_LOOKBACK_DAYS = 20
_MAX_TICKERS = 80
_CACHE_TTL_S = 90  # keep well under 15 min delay budget
_CACHE: dict[str, Any] = {"at": 0.0, "key": "", "payload": None}

SOURCE_LABEL = "yahoo_prepost_5m"
INDEX_KIND = "pre_mkt_conviction_proxy"


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


def pre_mkt_price_change_pct(pre_mkt_last: Any, prior_close: Any) -> float | None:
    """(PreMktLastPrice − PriorClose) / PriorClose * 100."""
    last = _finite(pre_mkt_last)
    close = _finite(prior_close)
    if last is None or close is None or close <= 0:
        return None
    return round((last - close) / close * 100.0, 4)


def pre_mkt_vol_ratio(pre_mkt_volume_today: Any, pre_mkt_volume_avg_20d: Any) -> float | None:
    """PreMktVolume(today) / PreMktVolume_avg(20d)."""
    today = _finite(pre_mkt_volume_today)
    avg = _finite(pre_mkt_volume_avg_20d)
    if today is None or avg is None or avg <= 0 or today < 0:
        return None
    return round(today / avg, 4)


def classify_pre_mkt_conviction(
    price_change_pct: Any,
    vol_ratio: Any,
    *,
    together_vol_min: float = VOL_RATIO_TOGETHER,
) -> str | None:
    """
    Returns together_up | together_down | diverge | None (no usable print).
    None → UI "—".
    """
    px = _finite(price_change_pct)
    vr = _finite(vol_ratio)
    if px is None:
        return None
    if abs(px) < 1e-9:
        # Flat price with no meaningful move — treat as no conviction print.
        return None if vr is None or vr <= 0 else "diverge"
    if vr is None:
        # Price moved but we cannot judge participation → diverge (weak).
        return "diverge"
    if vr > together_vol_min:
        return "together_up" if px > 0 else "together_down"
    return "diverge"


def compute_conviction_confirmed(
    conviction: str | None,
    search_buzz_delta_pct: Any,
) -> bool | None:
    """
    TRUE only when together ↑/↓ AND same-day Search Buzz delta exists and
    points the same way. None when Search Buzz missing (show badge without flag).
    """
    if conviction not in ("together_up", "together_down"):
        return False if conviction else None
    buzz = _finite(search_buzz_delta_pct)
    if buzz is None:
        return None
    if conviction == "together_up":
        return bool(buzz > 0)
    return bool(buzz < 0)


def blank_row(ticker: str, *, status: str, error: str | None = None) -> dict[str, Any]:
    return {
        "ticker": ticker.strip().upper(),
        "index_kind": INDEX_KIND,
        "is_proxy": True,
        "source": SOURCE_LABEL,
        "pre_mkt_price_change_pct": None,
        "pre_mkt_vol_ratio": None,
        "conviction": None,
        "conviction_confirmed": None,
        "pre_mkt_last": None,
        "prior_close": None,
        "pre_mkt_volume": None,
        "pre_mkt_volume_avg_20d": None,
        "asof_et": None,
        "session_date": None,
        "volume_source": None,
        "status": status,
        "error": error,
    }


def build_row(
    ticker: str,
    *,
    pre_mkt_last: float | None,
    prior_close: float | None,
    pre_mkt_volume: float | None,
    pre_mkt_volume_avg_20d: float | None,
    search_buzz_delta_pct: float | None = None,
    asof_et: datetime | None = None,
    status: str = "ok",
    session_date: date | None = None,
    volume_source: str | None = None,
) -> dict[str, Any]:
    tk = ticker.strip().upper()
    # Yahoo free chart often prints premkt prices with Volume=0 — still a usable print.
    vol = _finite(pre_mkt_volume)
    if vol is not None and vol <= 0:
        vol = None
    if pre_mkt_last is None or prior_close is None:
        return blank_row(tk, status="no_premarket_trades")

    px = pre_mkt_price_change_pct(pre_mkt_last, prior_close)
    vr = pre_mkt_vol_ratio(vol, pre_mkt_volume_avg_20d)
    conviction = classify_pre_mkt_conviction(px, vr)
    if conviction is None:
        return blank_row(tk, status="no_premarket_trades")

    confirmed = compute_conviction_confirmed(conviction, search_buzz_delta_pct)
    return {
        "ticker": tk,
        "index_kind": INDEX_KIND,
        "is_proxy": True,
        "source": SOURCE_LABEL,
        "pre_mkt_price_change_pct": px,
        "pre_mkt_vol_ratio": vr,
        "conviction": conviction,
        "conviction_confirmed": confirmed,
        "pre_mkt_last": _finite(pre_mkt_last),
        "prior_close": _finite(prior_close),
        "pre_mkt_volume": vol,
        "pre_mkt_volume_avg_20d": _finite(pre_mkt_volume_avg_20d),
        "asof_et": (asof_et or now_et()).isoformat(),
        "session_date": session_date.isoformat() if session_date else None,
        "volume_source": volume_source,
        "status": status,
        "error": None,
    }


def _session_volumes_from_bars(
    timestamps: Sequence[Any],
    volumes: Sequence[Any],
    closes: Sequence[Any],
    *,
    today: date,
) -> tuple[float | None, float | None, datetime | None, list[float], dict[str, Any] | None]:
    """
    Aggregate pre-market (4:00–9:30 ET) volume/last per calendar day.

    Returns
      today_vol, today_last, today_asof, prior_day_volumes (vol>0 only),
      latest_session — most recent day ≤ today with a premkt last price
        {date, vol|None, last, asof}.
    """
    by_day: dict[date, dict[str, Any]] = {}
    for ts, vol, px in zip(timestamps, volumes, closes):
        try:
            if hasattr(ts, "to_pydatetime"):
                dt = ts.to_pydatetime()
            else:
                dt = ts
            if not isinstance(dt, datetime):
                continue
            # yfinance bars are usually already America/New_York; naive → treat as ET.
            et = now_et(dt if dt.tzinfo else dt.replace(tzinfo=NY_TZ))
        except Exception:
            continue
        t = et.timetz().replace(tzinfo=None)
        if not (PREMKT_START <= t < PREMKT_END):
            continue
        v = _finite(vol) or 0.0
        c = _finite(px)
        day = et.date()
        bucket = by_day.setdefault(day, {"vol": 0.0, "last": None, "last_et": None})
        bucket["vol"] += max(0.0, v)
        if c is not None:
            bucket["last"] = c
            bucket["last_et"] = et

    today_bucket = by_day.get(today)
    today_vol = float(today_bucket["vol"]) if today_bucket and today_bucket["vol"] > 0 else None
    today_last = today_bucket["last"] if today_bucket else None
    today_asof = today_bucket["last_et"] if today_bucket else None

    prior_vols: list[float] = []
    for day in sorted(by_day.keys()):
        if day >= today:
            continue
        vol = float(by_day[day]["vol"])
        if vol > 0:
            prior_vols.append(vol)

    latest_session: dict[str, Any] | None = None
    for day in sorted(by_day.keys(), reverse=True):
        if day > today:
            continue
        bucket = by_day[day]
        if bucket.get("last") is None:
            continue
        day_vol = float(bucket["vol"])
        latest_session = {
            "date": day,
            "vol": day_vol if day_vol > 0 else None,
            "last": bucket["last"],
            "asof": bucket.get("last_et"),
        }
        break

    return today_vol, today_last, today_asof, prior_vols, latest_session


def _prior_close_from_daily(hist_daily: Any) -> float | None:
    if hist_daily is None or getattr(hist_daily, "empty", True):
        return None
    try:
        closes = hist_daily["Close"].dropna()
        if closes.empty:
            return None
        return _finite(closes.iloc[-1])
    except Exception:
        return None


def _daily_prior_close(hist_daily: Any, *, before: date) -> float | None:
    """Last regular-session close strictly before ``before``."""
    if hist_daily is None or getattr(hist_daily, "empty", True):
        return None
    try:
        closes: list[float] = []
        for i, px in zip(hist_daily.index, hist_daily["Close"].values):
            if hasattr(i, "to_pydatetime"):
                d = now_et(i.to_pydatetime()).date()
            elif isinstance(i, datetime):
                d = now_et(i).date()
            else:
                d = getattr(i, "date", lambda: before)()
            if d < before:
                c = _finite(px)
                if c is not None:
                    closes.append(c)
        return closes[-1] if closes else None
    except Exception:
        return None


def _yahoo_live_premkt_quote(ticker_obj: Any) -> tuple[float | None, float | None]:
    """
    Live quote fields (when Yahoo exposes them during an active premkt session).
    Historical 5m charts usually have Volume=0 in extended hours — this is the
    only free path to PreMktVolRatio / Together ↑↓.
    """
    try:
        info = getattr(ticker_obj, "info", None) or {}
    except Exception:
        return None, None
    if not isinstance(info, dict):
        return None, None
    price = _finite(info.get("preMarketPrice"))
    vol = _finite(info.get("preMarketVolume"))
    if vol is not None and vol <= 0:
        vol = None
    return price, vol


def _fetch_yahoo_premarket(ticker: str, *, today: date) -> dict[str, Any]:
    """
    Free-tier Yahoo via yfinance: 5m bars with prepost=True.
    No paid API key. Fail soft → blank row.

    Note: Yahoo chart Volume is typically 0 for extended-hours bars. We still
    emit price-based conviction (usually ``diverge``). Live ``preMarketVolume``
    from quote info is used when present for vol ratio / Together.
    """
    try:
        import yfinance as yf
    except ImportError:
        return blank_row(ticker, status="yfinance_missing", error="yfinance not installed")

    tk = ticker.strip().upper()
    try:
        t = yf.Ticker(tk)
        # ~1 month of 5m + pre/post covers ~20 pre-market sessions for the avg.
        hist = t.history(period="1mo", interval="5m", prepost=True, auto_adjust=False)
        daily = t.history(period="10d", interval="1d", auto_adjust=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Yahoo premarket fetch failed for %s: %s", tk, exc)
        return blank_row(tk, status="fetch_error", error=str(exc)[:160])

    if hist is None or getattr(hist, "empty", True):
        return blank_row(tk, status="no_premarket_trades")

    try:
        ts = list(hist.index)
        vols = list(hist["Volume"].values)
        closes = list(hist["Close"].values)
    except Exception as exc:  # noqa: BLE001
        return blank_row(tk, status="fetch_error", error=str(exc)[:160])

    today_vol, today_last, asof, prior_vols, latest = _session_volumes_from_bars(
        ts, vols, closes, today=today
    )

    session_date = today
    status = "ok"
    pre_last = _finite(today_last)
    pre_vol = _finite(today_vol)
    volume_source: str | None = "chart_5m" if pre_vol is not None else None

    # Weekend / holiday: show last available premkt session instead of blank column.
    if pre_last is None and latest is not None:
        session_date = latest["date"]
        pre_last = _finite(latest.get("last"))
        pre_vol = _finite(latest.get("vol"))
        asof = latest.get("asof") if isinstance(latest.get("asof"), datetime) else asof
        status = "prior_session"
        volume_source = "chart_5m" if pre_vol is not None else None

    live_px, live_vol = _yahoo_live_premkt_quote(t)
    if status == "ok":
        if live_px is not None:
            pre_last = live_px
        if live_vol is not None:
            pre_vol = live_vol
            volume_source = "quote_live"

    prior_close = _daily_prior_close(daily, before=session_date)
    if prior_close is None:
        prior_close = _prior_close_from_daily(daily)

    avg20 = None
    if prior_vols:
        window = prior_vols[-VOL_AVG_LOOKBACK_DAYS:]
        if window:
            avg20 = sum(window) / len(window)

    return build_row(
        tk,
        pre_mkt_last=pre_last,
        prior_close=_finite(prior_close),
        pre_mkt_volume=pre_vol,
        pre_mkt_volume_avg_20d=_finite(avg20),
        asof_et=asof if isinstance(asof, datetime) else now_et(),
        status=status,
        session_date=session_date,
        volume_source=volume_source,
    )


def fetch_pre_mkt_conviction(
    tickers: str | Sequence[str] | None,
    *,
    search_buzz_by_ticker: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """
    Snapshot for Catalyst Pre-Mkt Conviction column (proxy).

    ``search_buzz_by_ticker`` maps ticker → interest_delta_pct (or full row with
    that field). Missing buzz → conviction_confirmed stays null.
    """
    et = now_et(now)
    today = et.date()

    if isinstance(tickers, str):
        raw_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    elif tickers is None:
        raw_list = []
    else:
        raw_list = [str(t).strip().upper() for t in tickers if str(t).strip()]

    clean: list[str] = []
    seen: set[str] = set()
    for tk in raw_list:
        if tk and tk not in seen:
            seen.add(tk)
            clean.append(tk)
    clean = clean[:_MAX_TICKERS]

    cache_key = ",".join(clean)
    buzz = search_buzz_by_ticker or {}
    # Bust cache when buzz map identity changes enough (include buzz keys).
    buzz_sig = ",".join(
        f"{k}:{_finite(v.get('interest_delta_pct') if isinstance(v, dict) else v)}"
        for k in clean
        for v in [buzz.get(k)]
    )
    full_key = f"{cache_key}|{today.isoformat()}|{buzz_sig}"
    cached = _CACHE.get("payload")
    if (
        cached
        and _CACHE.get("key") == full_key
        and (time.time() - float(_CACHE.get("at") or 0)) < _CACHE_TTL_S
    ):
        return cached

    note_parts = [
        "Proxy of opening pressure from executed pre-market trades (Yahoo 5m prepost) — "
        "NOT official exchange order imbalance / NOII.",
        "Yahoo chart Volume is often 0 in extended hours; Together ↑/↓ needs live quote volume.",
    ]
    if et.weekday() >= 5:
        note_parts.append("Weekend — showing last prior pre-market session when available.")

    rows: dict[str, dict[str, Any]] = {}
    for tk in clean:
        row = _fetch_yahoo_premarket(tk, today=today)
        raw_buzz = buzz.get(tk)
        if isinstance(raw_buzz, dict):
            buzz_pct = _finite(raw_buzz.get("interest_delta_pct"))
        else:
            buzz_pct = _finite(raw_buzz)
        if row.get("status") == "ok":
            row["conviction_confirmed"] = compute_conviction_confirmed(
                row.get("conviction"),
                buzz_pct,
            )
            row["search_buzz_delta_pct"] = buzz_pct
        rows[tk] = row

    payload = {
        "updated_at": _now_iso(),
        "asof_et": et.isoformat(),
        "rows": rows,
        "index_kind": INDEX_KIND,
        "is_proxy": True,
        "source": SOURCE_LABEL,
        "vol_ratio_together_min": VOL_RATIO_TOGETHER,
        "note": " ".join(note_parts),
        "error": None,
        "paid_dependency": False,
    }
    _CACHE["at"] = time.time()
    _CACHE["key"] = full_key
    _CACHE["payload"] = payload
    return payload


def clear_cache_for_tests() -> None:
    _CACHE["at"] = 0.0
    _CACHE["key"] = ""
    _CACHE["payload"] = None
