"""
Catalyst table — Short Interest / Cost-to-Borrow (Framework v2 signal 1).

Display only — not a Soft BUY/SELL input.

Formulas (brief):
  DaysToCover(t)   = ShortInterest(t) / ADV_20d(t)
  ΔSI_pct          = (SI(t) - SI(t-1)) / SI(t-1) * 100
  BorrowFeeDelta5d = BorrowFee(t) - BorrowFee(t-5)   # only if a loan feed exists
  Utilization      = SharesOnLoan / SharesAvailable  # only if the feed exposes it
  SqueezeRiskFlag  = DTC > 5 AND BorrowFeeDelta5d > 0 AND PriceReturn_5d > 0

Missing inputs stay None and render as "—" — never a silent 0.
Borrow fee / utilization are not estimated: Yahoo/FMP do not expose a stock-loan
feed, so those fields remain None until a contracted vendor is wired.
SI prints are bi-monthly; cache TTL is hours, not a live intra-day poll.
"""
from __future__ import annotations

import json
import logging
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

logger = logging.getLogger("supernova.catalyst_si")

_CACHE_DIR = Path("data") / "cache" / "catalyst_short_interest"
_TTL_S = 18 * 60 * 60
# Must cover the full Catalyst hot-zone desk (morning ∪ hourly), not a hard 32.
_MAX_TICKERS = 80

# Brief starting rule — not a calibrated Soft BUY/SELL gate.
SQUEEZE_DTC_MIN = 5.0


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


def days_to_cover(short_interest_shares: Any, adv_20d: Any) -> float | None:
    """DaysToCover = ShortInterest / ADV_20d. None if either input is missing."""
    si = _finite(short_interest_shares)
    adv = _finite(adv_20d)
    if si is None or adv is None or adv <= 0 or si < 0:
        return None
    return round(si / adv, 2)


def si_delta_pct(si_t: Any, si_prev: Any) -> float | None:
    """ΔSI_pct vs the previous official print. None if either print is missing."""
    cur = _finite(si_t)
    prev = _finite(si_prev)
    if cur is None or prev is None or prev == 0:
        return None
    return round((cur - prev) / prev * 100.0, 2)


def borrow_fee_delta_5d(fee_t: Any, fee_t5: Any) -> float | None:
    """BorrowFee(t) − BorrowFee(t−5). None unless both prints exist (no estimate)."""
    a = _finite(fee_t)
    b = _finite(fee_t5)
    if a is None or b is None:
        return None
    return round(a - b, 4)


def utilization(shares_on_loan: Any, shares_available: Any) -> float | None:
    """SharesOnLoan / SharesAvailable. None if the loan feed does not expose it."""
    on = _finite(shares_on_loan)
    avail = _finite(shares_available)
    if on is None or avail is None or avail <= 0 or on < 0:
        return None
    return round(on / avail, 4)


def price_return_nd(closes: Sequence[Any], days: int = 5) -> float | None:
    """Simple close-to-close return over ``days`` sessions. None if history is short."""
    vals = [_finite(x) for x in closes]
    clean = [x for x in vals if x is not None]
    if len(clean) < days + 1:
        return None
    start = clean[-(days + 1)]
    end = clean[-1]
    if start is None or end is None or start <= 0:
        return None
    return (end - start) / start


def squeeze_risk_flag(
    dtc: Any,
    borrow_fee_delta_5d_val: Any,
    price_return_5d: Any,
    *,
    dtc_min: float = SQUEEZE_DTC_MIN,
) -> bool | None:
    """
    TRUE only when every required input is present and all three conditions hold.
    None when the flag cannot be evaluated (typical: no borrow-fee feed).
    Never treat a missing borrow fee as 0.
    """
    dtc_n = _finite(dtc)
    fee_d = _finite(borrow_fee_delta_5d_val)
    ret = _finite(price_return_5d)
    if dtc_n is None or fee_d is None or ret is None:
        return None
    return bool(dtc_n > dtc_min and fee_d > 0 and ret > 0)


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


def _yahoo_info(ticker: str) -> dict[str, Any]:
    try:
        import yfinance as yf

        raw = yf.Ticker(ticker).info
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _closes_and_volumes(ticker: str) -> tuple[list[float], list[float]]:
    try:
        from prediction.scoring_data import load_price_series

        closes, vols = load_price_series(ticker, "60d")
        c = [float(x) for x in (closes or []) if _finite(x) is not None]
        v = [float(x) for x in (vols or []) if _finite(x) is not None]
        if len(c) >= 6:
            return c, v
    except Exception:
        pass
    try:
        import yfinance as yf

        hist = yf.Ticker(ticker).history(period="3mo", auto_adjust=False)
        if hist is None or hist.empty:
            return [], []
        closes = [float(x) for x in hist["Close"].tolist() if _finite(x) is not None]
        vols = [float(x) for x in hist["Volume"].tolist() if _finite(x) is not None]
        return closes, vols
    except Exception:
        return [], []


def _adv_20d(volumes: Sequence[float]) -> float | None:
    if len(volumes) < 20:
        return None
    vals = [_finite(x) for x in volumes[-20:]]
    clean = [x for x in vals if x is not None and x > 0]
    if len(clean) < 20:
        return None
    return sum(clean) / 20.0


def build_short_interest_row(
    ticker: str,
    *,
    shares_short: Any = None,
    shares_short_prior: Any = None,
    yahoo_short_ratio: Any = None,
    volumes: Sequence[float] | None = None,
    closes: Sequence[float] | None = None,
    borrow_fee: Any = None,
    borrow_fee_t5: Any = None,
    shares_on_loan: Any = None,
    shares_available: Any = None,
    si_asof: str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Pure row builder — used by fetch and unit tests. Missing → None."""
    tk = ticker.strip().upper()
    vols = list(volumes or [])
    cls = list(closes or [])
    adv = _adv_20d(vols)
    dtc = days_to_cover(shares_short, adv)
    if dtc is None:
        dtc = _finite(yahoo_short_ratio)
        if dtc is not None:
            dtc = round(dtc, 2)
    fee_delta = borrow_fee_delta_5d(borrow_fee, borrow_fee_t5)
    ret5 = price_return_nd(cls, 5)
    flag = squeeze_risk_flag(dtc, fee_delta, ret5)
    return {
        "ticker": tk,
        "days_to_cover": dtc,
        "si_shares": _finite(shares_short),
        "si_shares_prior": _finite(shares_short_prior),
        "si_delta_pct": si_delta_pct(shares_short, shares_short_prior),
        "adv_20d": adv,
        "borrow_fee": _finite(borrow_fee),
        "borrow_fee_delta_5d": fee_delta,
        "utilization": utilization(shares_on_loan, shares_available),
        "price_return_5d": None if ret5 is None else round(ret5, 6),
        "squeeze_risk": flag,
        "si_asof": si_asof,
        "source": source,
        "borrow_feed": fee_delta is not None,
        "stale_note": "bi_monthly_si",
        "updated_at": _now_iso(),
    }


def _fetch_live_row(ticker: str) -> dict[str, Any]:
    tk = ticker.strip().upper()
    info = _yahoo_info(tk)
    closes, vols = _closes_and_volumes(tk)
    asof = info.get("dateShortInterest")
    asof_s = None
    if asof is not None:
        try:
            asof_s = str(asof)[:10]
        except Exception:
            asof_s = None
    row = build_short_interest_row(
        tk,
        shares_short=info.get("sharesShort"),
        shares_short_prior=info.get("sharesShortPriorMonth"),
        yahoo_short_ratio=info.get("shortRatio"),
        volumes=vols,
        closes=closes,
        si_asof=asof_s,
        source="yfinance" if info else None,
    )
    if row.get("days_to_cover") is None and row.get("si_shares") is None:
        row["error"] = "no_short_interest_coverage"
    return row


def fetch_catalyst_short_interest(
    tickers: str | list[str] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    wanted = parse_tickers(tickers)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "note": "bi_monthly_si_not_intraday",
    }
    if not wanted:
        payload["error"] = "empty_tickers"
        return payload

    now = time.time()
    for tk in wanted:
        path = _cache_path(tk)
        cached = _read_json(path)
        fresh = (
            cached is not None
            and path.is_file()
            and (now - path.stat().st_mtime) < _TTL_S
        )
        if fresh and not force:
            payload["rows"][tk] = cached
            continue
        try:
            row = _fetch_live_row(tk)
        except Exception as exc:
            logger.warning("catalyst SI fetch failed %s: %s", tk, exc)
            if cached:
                payload["rows"][tk] = cached
            continue
        _write_json(path, row)
        payload["rows"][tk] = row
    return payload


def refresh_catalyst_short_interest_universe(*, force: bool = False) -> dict[str, Any]:
    """Once-daily warm of SI prints for the 10-day catalyst universe."""
    tickers: list[str] = []
    try:
        from event_vol_index import upcoming_pairs_from_snapshots

        tickers = parse_tickers([t for t, _ in upcoming_pairs_from_snapshots(10)])
    except Exception as exc:
        logger.warning("catalyst SI universe scan failed: %s", exc)
    return fetch_catalyst_short_interest(tickers, force=force)
