"""
Silent-money traces for the Decision desk (display only).

Not a Soft BUY/SELL input. These prints tend to move before price or search:
  1. Form 4 cluster — CEO/CMO buys 1–3 months before a binary event
  2. 13D / 13F accumulation by specialist biotech funds
  3. Rising call open interest or call skew into a PDUFA-style date
  4. Short covering weeks before the decision
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import quote

from prediction.sds_data_collector import (
    _fmp_get,
    _get_ticker_section,
    _is_fetchable_ticker,
    _is_fresh,
    _now_iso,
    _set_ticker_section,
    fmp_api_key,
    load_cached_cluster_b,
)

_FORM4_TTL_D = 1.0
_13D_TTL_D = 3.0
_OPTIONS_TTL_D = 1.0
_LOOKBACK_D = 90
_13D_LOOKBACK_D = 180
_MAX_TICKERS = 16
_MAX_LIVE = 2
_MAX_OPTIONS_LIVE = 1
_OFFICER_RE = re.compile(
    r"\b(ceo|chief executive|cmo|chief medical|president|coo|chief operating|"
    r"officer|director)\b",
    re.I,
)
_CEO_RE = re.compile(r"\b(ceo|chief executive)\b", re.I)
_CMO_RE = re.compile(r"\b(cmo|chief medical)\b", re.I)
_PURCHASE_RE = re.compile(r"\b(p-?purchase|purchase|buy)\b", re.I)
_SALE_RE = re.compile(r"\b(s-?sale|sale|sell)\b", re.I)


def _parse_iso_date(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _owner_role(title: str) -> str | None:
    t = title or ""
    if _CEO_RE.search(t):
        return "CEO"
    if _CMO_RE.search(t):
        return "CMO"
    if re.search(r"\bpresident\b", t, re.I):
        return "Pres"
    if re.search(r"\bcoo|chief operating\b", t, re.I):
        return "COO"
    if _OFFICER_RE.search(t):
        return "officer"
    return None


def _is_purchase(row: dict[str, Any]) -> bool:
    tx = str(row.get("transactionType") or row.get("transaction_type") or "").strip()
    acq = str(row.get("acquisitionOrDisposition") or row.get("acqOrDisp") or "").strip().upper()
    if _SALE_RE.search(tx):
        return False
    if acq == "D":
        return False
    if acq == "A":
        return True
    return bool(_PURCHASE_RE.search(tx))


def classify_form4_rows(
    rows: list[dict[str, Any]],
    *,
    today: date | None = None,
    lookback_days: int = _LOOKBACK_D,
) -> dict[str, Any]:
    """Officer Form 4 purchases in the last 1–3 months."""
    ref = today or date.today()
    cutoff = ref - timedelta(days=int(lookback_days))
    buys: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict) or not _is_purchase(row):
            continue
        role = _owner_role(
            str(row.get("typeOfOwner") or row.get("type_of_owner") or row.get("reportingName") or "")
        )
        if role is None:
            continue
        dt = _parse_iso_date(
            row.get("transactionDate") or row.get("transaction_date") or row.get("filingDate")
        )
        if dt is None or dt < cutoff or dt > ref:
            continue
        link = str(
            row.get("link")
            or row.get("url")
            or row.get("filingURL")
            or row.get("finalLink")
            or ""
        ).strip()
        buys.append(
            {
                "date": dt.isoformat(),
                "role": role,
                "name": str(row.get("reportingName") or row.get("reporting_name") or "").strip(),
                "shares": row.get("securitiesTransacted") or row.get("securities_transacted"),
                "link": link or None,
            }
        )
    buys.sort(key=lambda b: b["date"], reverse=True)
    roles = {str(b["role"]) for b in buys}
    key_roles = roles & {"CEO", "CMO"}
    cluster = len(buys) >= 2 or bool(key_roles)
    lead_role = "CEO" if "CEO" in roles else "CMO" if "CMO" in roles else (buys[0]["role"] if buys else None)
    return {
        "buys": buys[:8],
        "buy_count": len(buys),
        "cluster": bool(cluster and buys),
        "lead_role": lead_role,
        "event_date": buys[0]["date"] if buys else None,
        "link": buys[0].get("link") if buys else None,
        "status": "ok" if buys else "none",
    }


def _fetch_form4_payload(ticker: str) -> list[dict[str, Any]]:
    tk = ticker.upper()
    payload = _fmp_get(f"/stable/insider-trading?symbol={tk}&limit=80")
    if not payload:
        payload = _fmp_get(f"/api/v4/insider-trading?symbol={tk}&limit=80")
    if isinstance(payload, dict):
        payload = payload.get("data") or payload.get("transactions") or []
    return [r for r in payload if isinstance(r, dict)] if isinstance(payload, list) else []


def load_or_fetch_form4(ticker: str, *, force: bool = False) -> dict[str, Any]:
    tk = ticker.strip().upper()
    empty = {
        "ticker": tk,
        "buys": [],
        "buy_count": 0,
        "cluster": False,
        "lead_role": None,
        "event_date": None,
        "status": "none",
        "fetched_at": _now_iso(),
    }
    if not _is_fetchable_ticker(tk):
        empty["status"] = "invalid_ticker"
        return empty
    if not force:
        cached = _get_ticker_section(tk, "form4")
        if cached and _is_fresh(cached.get("fetched_at"), _FORM4_TTL_D):
            return cached
    if not fmp_api_key():
        cached = _get_ticker_section(tk, "form4")
        if cached:
            return cached
        empty["status"] = "no_fmp_key"
        return empty
    classified = classify_form4_rows(_fetch_form4_payload(tk))
    out = {"ticker": tk, "fetched_at": _now_iso(), **classified}
    _set_ticker_section(tk, "form4", out)
    return out


def classify_13d_filings(
    rows: list[dict[str, Any]],
    *,
    today: date | None = None,
    lookback_days: int = _13D_LOOKBACK_D,
) -> dict[str, Any]:
    """Recent Schedule 13D / 13D/A — beneficial ownership with intent."""
    ref = today or date.today()
    cutoff = ref - timedelta(days=int(lookback_days))
    hits: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        form = str(
            row.get("type") or row.get("formType") or row.get("form") or row.get("filingType") or ""
        )
        compact = re.sub(r"[\s-]+", "", form).lower()
        if not re.match(r"^(sc)?13d/?a?$", compact):
            continue
        dt = _parse_iso_date(
            row.get("fillingDate")
            or row.get("filingDate")
            or row.get("acceptedDate")
            or row.get("date")
        )
        if dt is None or dt < cutoff or dt > ref:
            continue
        label = "13D/A" if compact.endswith("a") else "13D"
        link = str(row.get("link") or row.get("finalLink") or row.get("url") or "").strip()
        hits.append({"date": dt.isoformat(), "form": label, "link": link or None})
    hits.sort(key=lambda h: h["date"], reverse=True)
    return {
        "filings": hits[:6],
        "hit": bool(hits),
        "form": hits[0]["form"] if hits else None,
        "event_date": hits[0]["date"] if hits else None,
        "link": hits[0].get("link") if hits else None,
        "status": "ok" if hits else "none",
    }


def _fetch_13d_payload(ticker: str) -> list[dict[str, Any]]:
    tk = ticker.upper()
    payload = _fmp_get(f"/api/v3/sec_filings/{quote(tk, safe='')}?limit=40")
    if not payload:
        payload = _fmp_get(f"/stable/sec-filings-search/symbol?symbol={quote(tk, safe='')}&limit=40")
    if isinstance(payload, dict):
        payload = payload.get("data") or payload.get("filings") or []
    return [r for r in payload if isinstance(r, dict)] if isinstance(payload, list) else []


def load_or_fetch_13d(ticker: str, *, force: bool = False) -> dict[str, Any]:
    tk = ticker.strip().upper()
    empty = {
        "ticker": tk,
        "filings": [],
        "hit": False,
        "form": None,
        "event_date": None,
        "status": "none",
        "fetched_at": _now_iso(),
    }
    if not _is_fetchable_ticker(tk):
        empty["status"] = "invalid_ticker"
        return empty
    if not force:
        cached = _get_ticker_section(tk, "13d")
        if cached and _is_fresh(cached.get("fetched_at"), _13D_TTL_D):
            return cached
    if not fmp_api_key():
        cached = _get_ticker_section(tk, "13d")
        if cached:
            return cached
        empty["status"] = "no_fmp_key"
        return empty
    classified = classify_13d_filings(_fetch_13d_payload(tk))
    out = {"ticker": tk, "fetched_at": _now_iso(), **classified}
    _set_ticker_section(tk, "13d", out)
    return out


def _opt_float(row: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            continue
        if n == n:
            return n
    return None


def classify_options_snapshot(
    calls: list[dict[str, Any]],
    puts: list[dict[str, Any]],
    *,
    spot: float | None = None,
    prev_call_oi: float | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Call-side OI growth and ATM call-vs-put IV skew (pre-binary tell)."""
    ref = today or date.today()
    call_oi = sum(_opt_float(r, "openInterest", "open_interest") or 0.0 for r in calls)
    put_oi = sum(_opt_float(r, "openInterest", "open_interest") or 0.0 for r in puts)
    call_vol = sum(_opt_float(r, "volume") or 0.0 for r in calls)
    put_vol = sum(_opt_float(r, "volume") or 0.0 for r in puts)
    oi_ratio = (call_oi / put_oi) if put_oi > 0 else None
    oi_delta_pct = None
    if prev_call_oi is not None and prev_call_oi > 0:
        oi_delta_pct = (call_oi - prev_call_oi) / prev_call_oi * 100.0
    growing = oi_delta_pct is not None and oi_delta_pct >= 20.0

    atm_call_iv = atm_put_iv = None
    if spot is not None and spot > 0:
        def _atm(rows: list[dict[str, Any]]) -> float | None:
            best: tuple[float, float] | None = None
            for row in rows:
                strike = _opt_float(row, "strike")
                iv = _opt_float(row, "impliedVolatility", "implied_volatility", "iv")
                if strike is None or iv is None:
                    continue
                dist = abs(strike - spot)
                if best is None or dist < best[0]:
                    best = (dist, iv)
            return best[1] if best else None

        atm_call_iv = _atm(calls)
        atm_put_iv = _atm(puts)
    call_skew = None
    if atm_call_iv is not None and atm_put_iv is not None:
        call_skew = atm_call_iv - atm_put_iv
    bullish_skew = call_skew is not None and call_skew >= 0.04
    heavy_call_oi = oi_ratio is not None and oi_ratio >= 1.5
    hit = bool(growing or bullish_skew or heavy_call_oi)
    if growing:
        kind = "oi_growth"
    elif bullish_skew:
        kind = "call_skew"
    elif heavy_call_oi:
        kind = "call_oi"
    else:
        kind = None
    return {
        "hit": hit,
        "kind": kind,
        "call_oi": round(call_oi) if call_oi else 0,
        "put_oi": round(put_oi) if put_oi else 0,
        "call_vol": round(call_vol) if call_vol else 0,
        "put_vol": round(put_vol) if put_vol else 0,
        "oi_ratio": round(oi_ratio, 2) if oi_ratio is not None else None,
        "oi_delta_pct": round(oi_delta_pct, 1) if oi_delta_pct is not None else None,
        "call_skew": round(call_skew, 3) if call_skew is not None else None,
        "event_date": ref.isoformat() if hit else None,
        "status": "ok" if hit else "none",
    }


def _rows_from_yf_frame(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    try:
        records = frame.to_dict("records")
    except Exception:
        return []
    return [r for r in records if isinstance(r, dict)]


def _fetch_options_payload(ticker: str) -> dict[str, Any]:
    tk = ticker.upper()
    try:
        import yfinance as yf

        t = yf.Ticker(tk)
        exps = list(t.options or [])
        if not exps:
            return {"calls": [], "puts": [], "spot": None}
        chain = t.option_chain(exps[0])
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
        return {
            "calls": _rows_from_yf_frame(getattr(chain, "calls", None)),
            "puts": _rows_from_yf_frame(getattr(chain, "puts", None)),
            "spot": spot,
        }
    except Exception:
        return {"calls": [], "puts": [], "spot": None}


def load_or_fetch_options(ticker: str, *, force: bool = False) -> dict[str, Any]:
    tk = ticker.strip().upper()
    empty = {
        "ticker": tk,
        "hit": False,
        "kind": None,
        "event_date": None,
        "status": "none",
        "fetched_at": _now_iso(),
    }
    if not _is_fetchable_ticker(tk):
        empty["status"] = "invalid_ticker"
        return empty
    cached = _get_ticker_section(tk, "options")
    if not force and cached and _is_fresh(cached.get("fetched_at"), _OPTIONS_TTL_D):
        return cached
    prev_call_oi = None
    if cached:
        try:
            prev_call_oi = float(cached.get("call_oi")) if cached.get("call_oi") is not None else None
        except (TypeError, ValueError):
            prev_call_oi = None
    payload = _fetch_options_payload(tk)
    classified = classify_options_snapshot(
        payload.get("calls") or [],
        payload.get("puts") or [],
        spot=payload.get("spot"),
        prev_call_oi=prev_call_oi,
    )
    out = {"ticker": tk, "fetched_at": _now_iso(), **classified}
    _set_ticker_section(tk, "options", out)
    return out


def _edgar_browse(ticker: str, form: str) -> str:
    tk = quote(str(ticker or "").strip().upper(), safe="")
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&ticker={tk}&type={quote(form, safe='')}&owner=include&count=10"
    )


def _event(
    *,
    kind: str,
    label: str,
    date: Any,
    rank: int,
    href: str | None = None,
    href_label: str = "SEC",
    detail: str | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": label,
        "date": date,
        "detail": detail,
        "rank": rank,
        "href": href,
        "href_label": href_label,
    }


def _short_label(short: dict[str, Any] | None, ticker: str = "") -> dict[str, Any] | None:
    if not short:
        return None
    squeeze = bool(short.get("squeeze_setup"))
    try:
        dtc = float(short.get("days_to_cover")) if short.get("days_to_cover") is not None else None
    except (TypeError, ValueError):
        dtc = None
    try:
        score = float(short.get("score")) if short.get("score") is not None else 0.0
    except (TypeError, ValueError):
        score = 0.0
    covering = squeeze or (dtc is not None and dtc >= 5) or score > 0
    if not covering:
        return None
    fetched = str(short.get("fetched_at") or "")[:10]
    return _event(
        kind="short_cover",
        label="Shorts covering",
        date=fetched or None,
        detail=f"DTC {dtc:.0f}d" if dtc is not None else None,
        rank=55,
        href="https://www.finra.org/finra-data/browse-catalog/equity-short-interest/current",
        href_label="FINRA",
    )


def _inst_label(inst: dict[str, Any] | None, ticker: str = "") -> dict[str, Any] | None:
    if not inst:
        return None
    try:
        delta = float(inst.get("inst_delta_pct") if inst.get("inst_delta_pct") is not None else inst.get("delta_pct"))
    except (TypeError, ValueError):
        delta = None
    try:
        score = float(inst.get("score")) if inst.get("score") is not None else None
    except (TypeError, ValueError):
        score = None
    premium = bool(inst.get("premium_fund_present"))
    funds = inst.get("premium_funds_list") or inst.get("premium_funds") or []
    fund = ""
    if isinstance(funds, list) and funds:
        fund = str(funds[0]).split(",")[0].strip()
        fund = " ".join(fund.split()[:2])
    accum = (delta is not None and delta > 0) or (score is not None and score > 0) or premium
    if not accum:
        return None
    q = str(inst.get("latest_quarter") or "")[:10] or None
    label = f"{fund} accumulated" if fund else "Specialist funds accumulated"
    return _event(
        kind="13f",
        label=label,
        date=q,
        detail=f"{delta:+.0f}%" if delta is not None else None,
        rank=80 if premium else 65,
        href=_edgar_browse(ticker, "13F-HR") if ticker else None,
        href_label="SEC",
    )


def _form4_label(form4: dict[str, Any] | None, ticker: str = "") -> dict[str, Any] | None:
    if not form4 or not form4.get("cluster"):
        return None
    role = str(form4.get("lead_role") or "officer")
    n = int(form4.get("buy_count") or 0)
    if role in {"CEO", "CMO", "COO", "Pres"}:
        label = f"{role} bought shares" if n <= 1 else f"{role} cluster bought shares"
    else:
        label = "Insiders bought shares"
    href = str(form4.get("link") or "") or (_edgar_browse(ticker, "4") if ticker else "")
    return _event(
        kind="form4",
        label=label,
        date=form4.get("event_date"),
        rank=100,
        href=href or None,
        href_label="SEC",
    )


def _13d_label(doc: dict[str, Any] | None, ticker: str = "") -> dict[str, Any] | None:
    if not doc or not doc.get("hit"):
        return None
    form = str(doc.get("form") or "13D")
    href = str(doc.get("link") or "") or (_edgar_browse(ticker, "SC 13D") if ticker else "")
    return _event(
        kind="13d",
        label="New 13D beneficial owner" if form == "13D" else "13D amended",
        date=doc.get("event_date"),
        rank=90,
        href=href or None,
        href_label="SEC",
    )


def _options_label(doc: dict[str, Any] | None, ticker: str = "") -> dict[str, Any] | None:
    if not doc or not doc.get("hit"):
        return None
    kind = str(doc.get("kind") or "call_skew")
    delta = doc.get("oi_delta_pct")
    skew = doc.get("call_skew")
    ratio = doc.get("oi_ratio")
    if kind == "oi_growth" and delta is not None:
        label = "Call open interest rising"
        rank = 72
    elif kind == "call_skew" and skew is not None:
        label = "Call skew into event"
        rank = 70
    elif ratio is not None:
        label = "Call-heavy open interest"
        rank = 68
    else:
        label = "Call interest rising"
        rank = 68
    href = (
        f"https://finance.yahoo.com/quote/{quote(ticker)}/options/"
        if ticker
        else None
    )
    return _event(
        kind="call_skew",
        label=label,
        date=doc.get("event_date"),
        rank=rank,
        href=href,
        href_label="Yahoo",
    )


def compose_smart_money_event(
    *,
    form4: dict[str, Any] | None = None,
    inst: dict[str, Any] | None = None,
    filing_13d: dict[str, Any] | None = None,
    options: dict[str, Any] | None = None,
    short: dict[str, Any] | None = None,
    ticker: str = "",
) -> dict[str, Any]:
    """Form 4 > 13D > 13F premium > call OI/skew > 13F > short cover."""
    tk = str(ticker or "").strip().upper()
    candidates = [
        c
        for c in (
            _form4_label(form4, tk),
            _13d_label(filing_13d, tk),
            _inst_label(inst, tk),
            _options_label(options, tk),
            _short_label(short, tk),
        )
        if c
    ]
    candidates.sort(key=lambda c: int(c.get("rank") or 0), reverse=True)
    top = candidates[0] if candidates else None
    return {
        "event": top,
        "traces": candidates,
    }


def fetch_smart_money(tickers: list[str] | str) -> dict[str, Any]:
    parts = tickers.replace(";", ",").split(",") if isinstance(tickers, str) else list(tickers)
    wanted: list[str] = []
    seen: set[str] = set()
    for p in parts:
        tk = str(p).strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        wanted.append(tk)
        if len(wanted) >= _MAX_TICKERS:
            break
    rows: dict[str, Any] = {}
    live = 0
    live_13d = 0
    live_opt = 0
    for tk in wanted:
        cached = _get_ticker_section(tk, "form4")
        fresh = bool(cached and _is_fresh(cached.get("fetched_at"), _FORM4_TTL_D))
        if fresh:
            form4 = cached
        elif live < _MAX_LIVE:
            form4 = load_or_fetch_form4(tk)
            live += 1
        else:
            form4 = cached or {"ticker": tk, "cluster": False, "status": "stale"}
        cached_13d = _get_ticker_section(tk, "13d")
        if cached_13d and _is_fresh(cached_13d.get("fetched_at"), _13D_TTL_D):
            filing_13d = cached_13d
        elif live_13d < _MAX_LIVE:
            filing_13d = load_or_fetch_13d(tk)
            live_13d += 1
        else:
            filing_13d = cached_13d or {"ticker": tk, "hit": False, "status": "stale"}
        cached_opt = _get_ticker_section(tk, "options")
        if cached_opt and _is_fresh(cached_opt.get("fetched_at"), _OPTIONS_TTL_D):
            options = cached_opt
        elif live_opt < _MAX_OPTIONS_LIVE:
            options = load_or_fetch_options(tk)
            live_opt += 1
        else:
            options = cached_opt or {"ticker": tk, "hit": False, "status": "stale"}
        cluster = load_cached_cluster_b(tk) or {}
        short_sec = _get_ticker_section(tk, "short") or {}
        composed = compose_smart_money_event(
            ticker=tk,
            form4=form4,
            filing_13d=filing_13d,
            options=options,
            inst={
                "inst_delta_pct": cluster.get("inst_delta_pct"),
                "premium_fund_present": cluster.get("premium_fund_present"),
                "premium_funds_list": cluster.get("premium_funds_list"),
                "latest_quarter": cluster.get("latest_quarter"),
            },
            short={
                "days_to_cover": short_sec.get("days_to_cover") or cluster.get("days_to_cover"),
                "squeeze_setup": short_sec.get("squeeze_setup"),
                "score": short_sec.get("score"),
                "fetched_at": short_sec.get("fetched_at"),
            },
        )
        rows[tk] = {
            "ticker": tk,
            "form4": {
                "cluster": bool((form4 or {}).get("cluster")),
                "lead_role": (form4 or {}).get("lead_role"),
                "event_date": (form4 or {}).get("event_date"),
                "buy_count": (form4 or {}).get("buy_count") or 0,
                "status": (form4 or {}).get("status"),
            },
            **composed,
        }
    return {
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "rows": rows,
    }
