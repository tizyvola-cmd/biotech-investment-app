"""
Cluster B data collector — short interest + analyst upgrades.

Short interest: FMP (legacy v4 when subscribed) with **yfinance fallback**
(``shortPercentOfFloat`` / ``sharesShort``) when FMP is unavailable or on free tier.

Caches in ``data/sds_institutional_cache.json``:
  - short float: refresh twice weekly (~3.5 day TTL)
  - analyst grades: refresh daily (1 day TTL)

On total failure returns ``None`` for scores (UI shows planned/missing, not 0.0).
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from orchestrator_io_paths import DATA_DIR

_INST_CACHE_PATH = Path(DATA_DIR) / "sds_institutional_cache.json"
_LEGACY_CACHE_DIR = Path(DATA_DIR) / "sds_fmp_cache"

# Short: ~3 days (FINRA biweekly); grades daily; 13F weekly.
_SHORT_TTL_D = 3.0
_GRADES_TTL_D = 1
_13F_TTL_D = 7
_GRADES_LIMIT = 20
_GRADES_LOOKBACK_D = 60

TIER1_FIRMS: tuple[str, ...] = (
    "Goldman Sachs",
    "Leerink Partners",
    "SVB Securities",
    "Morgan Stanley",
    "Jefferies",
    "Evercore ISI",
    "Cowen",
    "RBC Capital Markets",
    "HC Wainwright",
    "Cantor Fitzgerald",
    "Needham",
    "Piper Sandler",
    "JMP Securities",
    "Oppenheimer",
)

PREMIUM_HEALTHCARE_FUNDS: tuple[str, ...] = (
    "RA Capital Management",
    "Vivo Capital",
    "Commodore Capital",
    "Foresite Capital",
    "OrbiMed Advisors",
    "Baker Bros Advisors",
    "Perceptive Advisors",
    "Deerfield Management",
    "Boxer Capital",
    "RTW Investments",
    "Farallon Capital",
    "Eventide Asset Management",
)

_QUALIFYING_ACTIONS = frozenset({"init", "upgrade", "reiterated", "resumed"})
_DOWNGRADE_ACTIONS = frozenset({"downgrade", "lowered", "cut", "reduce", "underperform"})

_GRADE_RANK: dict[str, int] = {
    "strong buy": 5,
    "buy": 4,
    "outperform": 4,
    "overweight": 4,
    "market outperform": 4,
    "positive": 4,
    "neutral": 3,
    "hold": 2,
    "equal-weight": 2,
    "equal weight": 2,
    "market perform": 2,
    "underperform": 1,
    "underweight": 1,
    "sell": 0,
    "negative": 0,
}


def fmp_api_key() -> str | None:
    for env in ("FMP_API_KEY", "FINANCIAL_MODELING_PREP_API_KEY"):
        v = os.environ.get(env, "").strip()
        if v:
            return v
    return None


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _parse_fetched_at(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if ts.tzinfo:
            ts = ts.replace(tzinfo=None)
        return ts
    except (TypeError, ValueError):
        return None


def _is_fresh(fetched_at: Any, ttl_days: float) -> bool:
    ts = _parse_fetched_at(fetched_at)
    if ts is None:
        return False
    return datetime.now() - ts <= timedelta(days=float(ttl_days))


def _load_inst_cache() -> dict[str, Any]:
    if not _INST_CACHE_PATH.is_file():
        return {"tickers": {}}
    try:
        doc = json.loads(_INST_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"tickers": {}}
    if not isinstance(doc, dict):
        return {"tickers": {}}
    doc.setdefault("tickers", {})
    return doc


def _save_inst_cache(doc: dict[str, Any]) -> None:
    _INST_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = dict(doc)
    out["updated_at"] = _now_iso()
    _INST_CACHE_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def _get_ticker_section(ticker: str, section: str) -> dict[str, Any] | None:
    tk = ticker.upper()
    doc = _load_inst_cache()
    sec = (doc.get("tickers") or {}).get(tk, {}).get(section)
    return sec if isinstance(sec, dict) else None


def _set_ticker_section(ticker: str, section: str, payload: dict[str, Any]) -> None:
    tk = ticker.upper()
    doc = _load_inst_cache()
    tickers = doc.setdefault("tickers", {})
    entry = tickers.setdefault(tk, {})
    entry[section] = dict(payload)
    _save_inst_cache(doc)


def _read_legacy_cache(ticker: str, kind: str, ttl_days: float) -> dict[str, Any] | None:
    path = _LEGACY_CACHE_DIR / f"{kind}_{ticker.upper()}.json"
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(doc, dict):
        return None
    if not _is_fresh(doc.get("fetched_at"), ttl_days):
        return None
    return doc


def _is_fetchable_ticker(ticker: str) -> bool:
    tk = ticker.strip().upper()
    if not tk or " " in tk:
        return False
    return tk.replace(".", "").replace("-", "").isalnum()


def _fmp_get(path: str, *, api_key: str | None = None) -> Any:
    key = api_key or fmp_api_key()
    if not key:
        return None
    sep = "&" if "?" in path else "?"
    url = f"https://financialmodelingprep.com{path}{sep}apikey={quote(key, safe='')}"
    try:
        req = Request(url, headers={"User-Agent": "SuperNova-SDS/1.0"})
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, OSError, json.JSONDecodeError, TimeoutError, ValueError):
        return None


def _normalize_short_pct(raw: Any) -> float | None:
    """Percent of float shorted (e.g. 15.3 for 15.3%)."""
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if v <= 1.0:
        return round(v * 100.0, 3)
    return round(v, 3)


def _short_fraction(pct: float | None) -> float | None:
    if pct is None:
        return None
    return pct / 100.0 if pct > 1.0 else pct


def _avg_volume_20d(volumes: Sequence[float]) -> float | None:
    if len(volumes) < 20:
        return None
    return sum(float(v) for v in volumes[-20:]) / 20.0


def compute_days_to_cover(
    short_interest_pct: float | None,
    shares_outstanding: float | None,
    volumes: Sequence[float],
) -> float | None:
    """
    days_to_cover = shortFraction × shares_outstanding / avg_volume_20d
    """
    frac = _short_fraction(short_interest_pct)
    if frac is None or shares_outstanding is None:
        return None
    try:
        shares = float(shares_outstanding)
    except (TypeError, ValueError):
        return None
    if shares <= 0:
        return None
    avg_vol = _avg_volume_20d(volumes)
    if avg_vol is None or avg_vol <= 0:
        return None
    return round(frac * shares / avg_vol, 2)


def is_tier1_firm(firm: str) -> bool:
    f = firm.strip().lower()
    if not f:
        return False
    return any(t.lower() in f for t in TIER1_FIRMS)


def _grade_rank(label: str | None) -> int | None:
    if not label:
        return None
    s = str(label).strip().lower()
    if s in _GRADE_RANK:
        return _GRADE_RANK[s]
    for key, rank in _GRADE_RANK.items():
        if key in s:
            return rank
    return None


def _infer_grade_action(previous: str | None, new: str | None) -> str | None:
    prev = str(previous or "").strip()
    new_g = str(new or "").strip()
    if not new_g or new_g.upper() in ("N/A", "—"):
        return None
    if not prev or prev.upper() in ("N/A", "—", "NONE", ""):
        return "init"
    pr = _grade_rank(prev)
    nr = _grade_rank(new_g)
    if pr is None or nr is None:
        return None
    if nr > pr:
        return "upgrade"
    if nr == pr:
        return "reiterated"
    return None


def _grade_points_v2(action: str, tier1: bool, days_ago: int) -> float:
    recency = 1.5 if days_ago <= 14 else 1.0
    if action == "init":
        base = 6.0 if tier1 else 3.0
    elif action == "upgrade":
        base = 4.0 if tier1 else 2.0
    elif action == "reiterated":
        base = 2.0 if tier1 else 1.0
    elif action == "resumed":
        base = 3.0 if tier1 else 1.5
    else:
        base = 0.0
    return base * recency


def _normalize_grade_action(raw: str, prev: str | None, new: str | None) -> str:
    action = raw.strip().lower()
    if action in _DOWNGRADE_ACTIONS:
        return "downgrade"
    if action in _QUALIFYING_ACTIONS:
        return action
    inferred = _infer_grade_action(prev, new) or ""
    if inferred in _QUALIFYING_ACTIONS:
        return inferred
    if inferred == "downgrade" or (inferred and inferred not in _QUALIFYING_ACTIONS):
        pr = _grade_rank(str(prev) if prev else None)
        nr = _grade_rank(str(new) if new else None)
        if pr is not None and nr is not None and nr < pr:
            return "downgrade"
    return action if action else ""


def _parse_grade_date(raw: Any) -> date | None:
    if raw is None:
        return None
    s = str(raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def analyst_score_from_grades(grades: list[dict[str, Any]], *, within_days: int = _GRADES_LOOKBACK_D) -> dict[str, Any]:
    """Score 0–8 from analyst actions in the last ``within_days``."""
    cutoff = date.today() - timedelta(days=int(within_days))
    today = date.today()
    score = 0.0
    hits: list[dict[str, Any]] = []
    downgrades = 0
    tier1_hit = False
    latest: dict[str, Any] | None = None

    for g in grades:
        if not isinstance(g, dict):
            continue
        gd = _parse_grade_date(g.get("date"))
        if gd is not None and gd < cutoff:
            continue
        days_ago = (today - gd).days if gd else 999

        firm = str(g.get("gradingCompany") or g.get("company") or g.get("firm") or "").strip()
        prev = g.get("previousGrade") or g.get("previousRating")
        new = g.get("newGrade") or g.get("newRating") or g.get("grade")
        action = _normalize_grade_action(str(g.get("action") or ""), str(prev) if prev else None, str(new) if new else None)

        if action == "downgrade":
            downgrades += 1
            hits.append(
                {
                    "date": gd.isoformat() if gd else str(g.get("date", ""))[:10],
                    "firm": firm,
                    "action": action,
                    "previous": prev,
                    "new": new,
                    "points": 0.0,
                    "tier1": is_tier1_firm(firm),
                    "price_target": g.get("priceTarget") or g.get("priceWhenPosted"),
                }
            )
            continue

        if action not in _QUALIFYING_ACTIONS:
            continue

        tier1 = is_tier1_firm(firm)
        if tier1:
            tier1_hit = True
        pts = _grade_points_v2(action, tier1, days_ago)
        score += pts
        row = {
            "date": gd.isoformat() if gd else str(g.get("date", ""))[:10],
            "firm": firm,
            "action": action,
            "previous": prev,
            "new": new,
            "points": round(pts, 2),
            "tier1": tier1,
            "price_target": g.get("priceTarget") or g.get("priceWhenPosted"),
        }
        hits.append(row)

    hits.sort(key=lambda h: h.get("date") or "", reverse=True)
    latest = hits[0] if hits else None

    if downgrades >= 2:
        score = max(score - 3.0, 0.0)

    upgrades_n = len([h for h in hits if h.get("action") in _QUALIFYING_ACTIONS and (h.get("points") or 0) > 0])

    return {
        "analyst_upgrade_score": round(min(score, 8.0), 2),
        "analyst_events_60d": hits,
        "analyst_events_30d": hits,
        "analyst_events_n": upgrades_n,
        "upgrades_count": upgrades_n,
        "downgrades_count": downgrades,
        "tier1_coverage": tier1_hit,
        "latest_action": latest,
        "all_grades_60d": hits[:20],
    }


def _yfinance_short_enabled() -> bool:
    v = os.environ.get("SDS_SHORT_USE_YFINANCE", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _yfinance_short_info(ticker: str) -> dict[str, Any]:
    """Live Yahoo Finance ``Ticker.info`` slice for short-interest fields."""
    tk = ticker.upper()
    try:
        import yfinance as yf

        raw = yf.Ticker(tk).info
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def _short_interest_from_yfinance_info(info: dict[str, Any]) -> tuple[float | None, int | None, float | None]:
    """Parse Yahoo info → (short_pct, shares_short, days_to_cover)."""
    si_raw = info.get("shortPercentOfFloat")
    if si_raw is None:
        shares_short = info.get("sharesShort")
        float_sh = info.get("floatShares")
        try:
            ss = float(shares_short) if shares_short is not None else None
            fs = float(float_sh) if float_sh is not None else None
        except (TypeError, ValueError):
            ss, fs = None, None
        if ss is not None and fs is not None and fs > 0:
            si_raw = ss / fs

    si_pct = _normalize_short_pct(si_raw)

    short_volume: int | None = None
    raw_vol = info.get("sharesShort")
    if raw_vol is not None:
        try:
            short_volume = int(float(raw_vol))
        except (TypeError, ValueError):
            short_volume = None

    dtc: float | None = None
    raw_dtc = info.get("shortRatio")
    if raw_dtc is not None:
        try:
            dtc = round(float(raw_dtc), 2)
        except (TypeError, ValueError):
            dtc = None

    return si_pct, short_volume, dtc


def fetch_short_interest_yfinance(
    ticker: str,
    *,
    volumes: Sequence[float] | None = None,
    shares_outstanding: float | None = None,
    info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Short interest from Yahoo Finance (free fallback when FMP unavailable)."""
    tk = ticker.upper()
    if not _is_fetchable_ticker(tk):
        return {
            "ticker": tk,
            "short_interest_pct": None,
            "short_volume": None,
            "days_to_cover": None,
            "source": "skipped",
            "error": "invalid_ticker",
        }

    yf_info = info if info is not None else _yfinance_short_info(tk)
    si_pct, short_volume, dtc = _short_interest_from_yfinance_info(yf_info)

    if dtc is None and si_pct is not None:
        if volumes is None or shares_outstanding is None:
            from prediction.scoring_data import load_enrich, load_price_series

            _, vols = load_price_series(tk, "5y")
            if len(vols) < 20:
                _, vols = load_price_series(tk, "60d")
            volumes = volumes if volumes is not None else vols
            if shares_outstanding is None:
                enrich = load_enrich(tk)
                raw_sh = enrich.get("sharesOutstanding") or enrich.get("shares_outstanding")
                try:
                    shares_outstanding = float(raw_sh) if raw_sh is not None else None
                except (TypeError, ValueError):
                    shares_outstanding = None
        dtc = compute_days_to_cover(si_pct, shares_outstanding, volumes or [])

    out: dict[str, Any] = {
        "ticker": tk,
        "short_interest_pct": si_pct,
        "short_volume": short_volume,
        "days_to_cover": dtc,
        "source": "yfinance",
        "fetched_at": _now_iso(),
    }
    if si_pct is None:
        out["error"] = "yfinance_missing"
    return out


def fetch_short_interest_fmp(
    ticker: str,
    *,
    api_key: str | None = None,
    use_cache: bool = True,
    volumes: Sequence[float] | None = None,
    shares_outstanding: float | None = None,
) -> dict[str, Any]:
    """
    GET /api/v4/short-float?symbol={ticker}

    Returns short_interest_pct, short_volume, days_to_cover (computed when possible).
    API failure → short_interest_pct is None (not cached).
    Falls back to yfinance when FMP unavailable.
    """
    tk = ticker.upper()

    if not _is_fetchable_ticker(tk):
        return {
            "ticker": tk,
            "short_interest_pct": None,
            "short_volume": None,
            "days_to_cover": None,
            "source": "skipped",
            "error": "invalid_ticker",
        }

    if use_cache:
        cached = _get_ticker_section(tk, "short")
        if cached and _is_fresh(cached.get("fetched_at"), _SHORT_TTL_D):
            if cached.get("short_interest_pct") is not None:
                return cached
        legacy = _read_legacy_cache(tk, "short", _SHORT_TTL_D)
        if legacy and legacy.get("short_interest_pct") is not None:
            return legacy

    if volumes is None or shares_outstanding is None:
        from prediction.scoring_data import load_enrich, load_price_series

        _, vols = load_price_series(tk, "5y")
        if len(vols) < 20:
            _, vols = load_price_series(tk, "60d")
        volumes = volumes if volumes is not None else vols
        if shares_outstanding is None:
            enrich = load_enrich(tk)
            raw_sh = enrich.get("sharesOutstanding") or enrich.get("shares_outstanding")
            try:
                shares_outstanding = float(raw_sh) if raw_sh is not None else None
            except (TypeError, ValueError):
                shares_outstanding = None

    si_pct: float | None = None
    short_volume: int | None = None
    dtc: float | None = None
    source = "fmp_v4_short_float"
    fmp_error: str | None = None

    if fmp_api_key() or api_key:
        payload = _fmp_get(f"/api/v4/short-float?symbol={quote(tk, safe='')}", api_key=api_key)
        if payload is None:
            fmp_error = "api_failed"
        elif not isinstance(payload, list) or not payload or not isinstance(payload[0], dict):
            fmp_error = "empty_response"
        else:
            row = payload[0]
            si_raw = (
                row.get("shortFloat")
                or row.get("shortPercentFloat")
                or row.get("shortInterestRatio")
                or row.get("shortPercentOfFloat")
            )
            short_vol = row.get("shortVolume") or row.get("short_volume")
            try:
                short_volume = int(float(short_vol)) if short_vol is not None else None
            except (TypeError, ValueError):
                short_volume = None

            si_pct = _normalize_short_pct(si_raw)
            dtc = compute_days_to_cover(si_pct, shares_outstanding, volumes or [])

            if dtc is None:
                api_dtc = row.get("daysToCover") or row.get("daysToCoverRatio")
                try:
                    dtc = round(float(api_dtc), 2) if api_dtc is not None else None
                except (TypeError, ValueError):
                    dtc = None

    if si_pct is None and _yfinance_short_enabled():
        yf_doc = fetch_short_interest_yfinance(
            tk,
            volumes=volumes,
            shares_outstanding=shares_outstanding,
        )
        if yf_doc.get("short_interest_pct") is not None:
            si_pct = yf_doc.get("short_interest_pct")
            short_volume = yf_doc.get("short_volume")
            dtc = yf_doc.get("days_to_cover")
            source = "yfinance"
            fmp_error = fmp_error or yf_doc.get("error")
        elif fmp_error is None:
            fmp_error = yf_doc.get("error") or "unavailable"

    out: dict[str, Any] = {
        "ticker": tk,
        "short_interest_pct": si_pct,
        "short_volume": short_volume,
        "days_to_cover": dtc,
        "source": source,
        "fetched_at": _now_iso(),
    }
    if fmp_error and si_pct is None:
        out["error"] = fmp_error
        out["status"] = "unavailable"
    elif fmp_error and source == "yfinance":
        out["fmp_error"] = fmp_error
    else:
        out["status"] = "ok" if si_pct is not None else "unavailable"

    if si_pct is not None and use_cache:
        _set_ticker_section(tk, "short", out)
    return out


def fetch_analyst_grades_fmp(ticker: str, *, api_key: str | None = None, use_cache: bool = True) -> dict[str, Any]:
    """GET /api/v3/grade/{ticker}?limit=10 — analyst upgrade score (0–8) or None on API failure."""
    tk = ticker.upper()

    if not _is_fetchable_ticker(tk):
        return {
            "ticker": tk,
            "analyst_upgrade_score": None,
            "analyst_events_30d": [],
            "analyst_events_n": 0,
            "source": "skipped",
            "error": "invalid_ticker",
        }

    if use_cache:
        cached = _get_ticker_section(tk, "grades")
        if cached and _is_fresh(cached.get("fetched_at"), _GRADES_TTL_D):
            if cached.get("analyst_upgrade_score") is not None:
                return cached
        legacy = _read_legacy_cache(tk, "grades", _GRADES_TTL_D)
        if legacy and legacy.get("analyst_upgrade_score") is not None:
            return legacy

    payload = _fmp_get(f"/api/v3/grade/{tk}?limit={_GRADES_LIMIT}", api_key=api_key)
    if payload is None or (isinstance(payload, list) and len(payload) == 0):
        payload = _fmp_get(f"/stable/grades?symbol={quote(tk, safe='')}&limit={_GRADES_LIMIT}", api_key=api_key)
    if payload is None:
        return {
            "ticker": tk,
            "analyst_upgrade_score": None,
            "analyst_events_60d": [],
            "analyst_events_n": 0,
            "source": "fmp_v3_grade",
            "error": "api_failed",
            "status": "unavailable",
        }

    grades: list[dict[str, Any]] = []
    if isinstance(payload, list):
        grades = [g for g in payload if isinstance(g, dict)]

    scored = analyst_score_from_grades(grades)
    out = {
        "ticker": tk,
        "source": "fmp_v3_grade",
        "grades_raw_n": len(grades),
        "fetched_at": _now_iso(),
        "status": "ok",
        **scored,
    }
    if not grades:
        out["error"] = "empty_response"
        out["status"] = "no_recent_coverage"

    if use_cache:
        _set_ticker_section(tk, "grades", out)
    return out


def _parse_report_date(raw: Any) -> date | None:
    return _parse_grade_date(raw)


def _is_premium_fund(holder: str) -> bool:
    h = holder.lower()
    return any(pf.lower() in h for pf in PREMIUM_HEALTHCARE_FUNDS)


def fetch_institutional_13f_fmp(
    ticker: str,
    *,
    api_key: str | None = None,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Institutional ownership delta from FMP 13F holder endpoint."""
    tk = ticker.upper()
    if not _is_fetchable_ticker(tk):
        return {"ticker": tk, "inst_delta_score": None, "status": "invalid_ticker"}

    if use_cache:
        cached = _get_ticker_section(tk, "13f")
        if cached and _is_fresh(cached.get("fetched_at"), _13F_TTL_D):
            return cached

    payload = _fmp_get(f"/api/v3/institutional-holder/{tk}", api_key=api_key)
    if payload is None or not isinstance(payload, list) or not payload:
        payload = _fmp_get(f"/stable/institutional-ownership/symbol-ownership?symbol={quote(tk, safe='')}", api_key=api_key)
        if isinstance(payload, dict):
            payload = payload.get("data") or payload.get("holders") or []

    if not payload or not isinstance(payload, list):
        out = {
            "ticker": tk,
            "inst_delta_score": None,
            "inst_delta_pct": None,
            "status": "no_institutional_data",
            "source": "fmp_13f",
            "fetched_at": _now_iso(),
        }
        if use_cache:
            _set_ticker_section(tk, "13f", out)
        return out

    by_quarter: dict[str, list[dict[str, Any]]] = {}
    for row in payload:
        if not isinstance(row, dict):
            continue
        qd = _parse_report_date(row.get("dateReported") or row.get("reportDate") or row.get("date"))
        if qd is None:
            continue
        key = qd.isoformat()
        by_quarter.setdefault(key, []).append(row)

    if len(by_quarter) < 2:
        out = {
            "ticker": tk,
            "inst_delta_score": None,
            "inst_delta_pct": None,
            "status": "no_institutional_data",
            "source": "fmp_13f",
            "fetched_at": _now_iso(),
        }
        if use_cache:
            _set_ticker_section(tk, "13f", out)
        return out

    quarters = sorted(by_quarter.keys(), reverse=True)
    latest_key, prev_key = quarters[0], quarters[1]
    latest_rows = by_quarter[latest_key]
    prev_rows = by_quarter[prev_key]

    def _shares(row: dict[str, Any]) -> float:
        for k in ("shares", "share", "totalShares", "weight"):
            v = row.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
        return 0.0

    total_latest = sum(_shares(r) for r in latest_rows)
    total_prev = sum(_shares(r) for r in prev_rows)
    delta_pct = ((total_latest - total_prev) / total_prev * 100.0) if total_prev > 0 else 0.0

    premium_entries: list[str] = []
    for row in latest_rows:
        holder = str(row.get("holder") or row.get("investorName") or row.get("name") or "").strip()
        change = row.get("change") or row.get("changeInShares")
        try:
            ch = float(change) if change is not None else 0.0
        except (TypeError, ValueError):
            ch = 0.0
        if _is_premium_fund(holder) and ch > 0:
            premium_entries.append(holder)

    latest_q_date = _parse_report_date(latest_key)
    staleness = (date.today() - latest_q_date).days if latest_q_date else None

    out = {
        "ticker": tk,
        "inst_delta_pct": round(delta_pct, 2),
        "premium_fund_present": len(premium_entries) > 0,
        "premium_funds_list": premium_entries,
        "total_inst_shares_latest": int(total_latest),
        "total_inst_shares_prev": int(total_prev),
        "latest_quarter": latest_key[:10],
        "staleness_days": staleness,
        "data_age_warning": bool(staleness and staleness > 75),
        "source": "fmp_13f",
        "status": "ok",
        "fetched_at": _now_iso(),
    }
    if use_cache:
        _set_ticker_section(tk, "13f", out)
    return out


def collect_fmp_cluster_b(
    ticker: str,
    *,
    api_key: str | None = None,
    use_cache: bool = True,
    force_refresh: bool = False,
    volumes: Sequence[float] | None = None,
    shares_outstanding: float | None = None,
) -> dict[str, Any]:
    """Short interest + analyst score for one ticker."""
    tk = ticker.upper()
    if force_refresh:
        use_cache = False
    short_doc = fetch_short_interest_fmp(
        tk,
        api_key=api_key,
        use_cache=use_cache,
        volumes=volumes,
        shares_outstanding=shares_outstanding,
    )
    grades_doc = fetch_analyst_grades_fmp(tk, api_key=api_key, use_cache=use_cache)
    inst_doc = fetch_institutional_13f_fmp(tk, api_key=api_key, use_cache=use_cache)
    return {
        "ticker": tk,
        "short_interest_pct": short_doc.get("short_interest_pct"),
        "short_volume": short_doc.get("short_volume"),
        "days_to_cover": short_doc.get("days_to_cover"),
        "short_status": short_doc.get("status"),
        "analyst_upgrade_score": grades_doc.get("analyst_upgrade_score"),
        "analyst_events_60d": grades_doc.get("analyst_events_60d") or grades_doc.get("analyst_events_30d") or [],
        "analyst_events_n": grades_doc.get("analyst_events_n") or 0,
        "upgrades_count": grades_doc.get("upgrades_count"),
        "downgrades_count": grades_doc.get("downgrades_count"),
        "tier1_coverage": grades_doc.get("tier1_coverage"),
        "latest_action": grades_doc.get("latest_action"),
        "all_grades_60d": grades_doc.get("all_grades_60d") or [],
        "analyst_status": grades_doc.get("status"),
        "grades_raw_n": grades_doc.get("grades_raw_n"),
        "inst_delta_pct": inst_doc.get("inst_delta_pct"),
        "inst_status": inst_doc.get("status"),
        "premium_fund_present": inst_doc.get("premium_fund_present"),
        "premium_funds_list": inst_doc.get("premium_funds_list") or [],
        "staleness_days": inst_doc.get("staleness_days"),
        "latest_quarter": inst_doc.get("latest_quarter"),
        "data_age_warning": inst_doc.get("data_age_warning"),
        "short_source": short_doc.get("source"),
        "fmp_short_error": short_doc.get("error") or short_doc.get("fmp_error"),
        "fmp_grades_error": grades_doc.get("error"),
        "fmp_inst_error": inst_doc.get("error"),
        "fmp_available": fmp_api_key() is not None,
    }


def load_cached_cluster_b(ticker: str, *, allow_stale: bool = True) -> dict[str, Any] | None:
    """Read cluster B from institutional cache (no network).

    When ``allow_stale`` (default), expired cache rows are still returned so light
    refresh does not zero-out B after TTL expiry.
    """
    tk = ticker.upper()

    def _pick(section: str, kind: str, ttl: float) -> dict[str, Any] | None:
        sec = _get_ticker_section(tk, section)
        if sec is None:
            sec = _read_legacy_cache(tk, kind, ttl)
        if sec is None:
            return None
        if _is_fresh(sec.get("fetched_at"), ttl):
            return sec
        return sec if allow_stale else None

    short_c = _pick("short", "short", _SHORT_TTL_D)
    grades_c = _pick("grades", "grades", _GRADES_TTL_D)
    inst_c = _pick("13f", "13f", _13F_TTL_D)

    if not short_c and not grades_c and not inst_c:
        return None
    return {
        "ticker": tk,
        "short_interest_pct": (short_c or {}).get("short_interest_pct"),
        "short_volume": (short_c or {}).get("short_volume"),
        "days_to_cover": (short_c or {}).get("days_to_cover"),
        "short_status": (short_c or {}).get("status"),
        "analyst_upgrade_score": (grades_c or {}).get("analyst_upgrade_score"),
        "analyst_events_60d": (grades_c or {}).get("analyst_events_60d") or (grades_c or {}).get("analyst_events_30d") or [],
        "analyst_events_n": (grades_c or {}).get("analyst_events_n") or 0,
        "upgrades_count": (grades_c or {}).get("upgrades_count"),
        "downgrades_count": (grades_c or {}).get("downgrades_count"),
        "tier1_coverage": (grades_c or {}).get("tier1_coverage"),
        "latest_action": (grades_c or {}).get("latest_action"),
        "all_grades_60d": (grades_c or {}).get("all_grades_60d") or [],
        "analyst_status": (grades_c or {}).get("status"),
        "inst_delta_pct": (inst_c or {}).get("inst_delta_pct"),
        "inst_delta_score": (inst_c or {}).get("inst_delta_score"),
        "inst_status": (inst_c or {}).get("status"),
        "premium_fund_present": (inst_c or {}).get("premium_fund_present"),
        "premium_funds_list": (inst_c or {}).get("premium_funds_list") or [],
        "staleness_days": (inst_c or {}).get("staleness_days"),
        "latest_quarter": (inst_c or {}).get("latest_quarter"),
        "data_age_warning": (inst_c or {}).get("data_age_warning"),
        "from_cache": True,
        "cache_stale": bool(
            (short_c and not _is_fresh(short_c.get("fetched_at"), _SHORT_TTL_D))
            or (grades_c and not _is_fresh(grades_c.get("fetched_at"), _GRADES_TTL_D))
            or (inst_c and not _is_fresh(inst_c.get("fetched_at"), _13F_TTL_D))
        ),
    }


def _yfinance_analyst_consensus_score(ticker: str) -> dict[str, Any] | None:
    """Fallback analyst signal from Yahoo consensus when FMP grades are missing."""
    info = _yfinance_short_info(ticker)
    if not info:
        return None
    try:
        n = int(float(info.get("numberOfAnalystOpinions") or 0))
    except (TypeError, ValueError):
        n = 0
    if n < 1:
        return None
    key = str(info.get("recommendationKey") or info.get("recommendationMean") or "").strip().lower()
    score_map = {
        "strong_buy": 6.0,
        "buy": 5.0,
        "hold": 2.0,
        "underperform": 1.0,
        "sell": 0.0,
        "strong_sell": 0.0,
        "1.0": 6.0,
        "1.5": 5.5,
        "2.0": 5.0,
        "2.5": 4.0,
        "3.0": 2.5,
        "3.5": 1.5,
        "4.0": 1.0,
        "4.5": 0.5,
        "5.0": 0.0,
    }
    base = score_map.get(key)
    if base is None:
        try:
            mean = float(key) if key.replace(".", "", 1).isdigit() else float(info.get("recommendationMean") or 0)
            if mean <= 1.5:
                base = 6.0
            elif mean <= 2.5:
                base = 4.5
            elif mean <= 3.5:
                base = 2.0
            else:
                base = 0.5
        except (TypeError, ValueError):
            base = 2.0
    return {
        "analyst_upgrade_score": round(min(float(base), 8.0), 2),
        "analyst_events_60d": [],
        "analyst_events_n": 0,
        "analyst_status": "yfinance_consensus",
        "source": "yfinance_consensus",
        "consensus_key": key or None,
        "analyst_count": n,
        "fetched_at": _now_iso(),
    }


def refresh_cluster_b_resilient(
    ticker: str,
    *,
    volumes: Sequence[float] | None = None,
    shares_outstanding: float | None = None,
    allow_network: bool = True,
) -> dict[str, Any]:
    """
    Cluster B for light / cached SDS passes:
    - start from cache (stale OK)
    - fill missing short via yfinance
    - refresh expired short/grades/13F via FMP when key present (unless disabled)
    - analyst consensus proxy when grades still missing
    """
    tk = ticker.upper()
    meta = load_cached_cluster_b(tk, allow_stale=True) or {"ticker": tk}

    def _short_stale() -> bool:
        sec = _get_ticker_section(tk, "short")
        return sec is None or not _is_fresh(sec.get("fetched_at"), _SHORT_TTL_D)

    def _grades_stale() -> bool:
        sec = _get_ticker_section(tk, "grades")
        return sec is None or not _is_fresh(sec.get("fetched_at"), _GRADES_TTL_D)

    def _inst_stale() -> bool:
        sec = _get_ticker_section(tk, "13f")
        return sec is None or not _is_fresh(sec.get("fetched_at"), _13F_TTL_D)

    need_short = meta.get("short_interest_pct") is None or _short_stale()
    need_grades = meta.get("analyst_upgrade_score") is None or _grades_stale()
    need_inst = meta.get("inst_delta_pct") is None and meta.get("inst_status") not in (
        "no_institutional_data",
        "invalid_ticker",
    )

    if allow_network and fmp_api_key():
        if need_short or need_grades or need_inst:
            fresh = collect_fmp_cluster_b(
                tk,
                use_cache=True,
                force_refresh=False,
                volumes=volumes,
                shares_outstanding=shares_outstanding,
            )
            for k, v in fresh.items():
                if v is not None:
                    meta[k] = v
            meta["from_cache"] = False
    elif need_short and _yfinance_short_enabled():
        yf_short = fetch_short_interest_yfinance(
            tk,
            volumes=volumes,
            shares_outstanding=shares_outstanding,
        )
        if yf_short.get("short_interest_pct") is not None:
            meta.update(
                {
                    "short_interest_pct": yf_short.get("short_interest_pct"),
                    "short_volume": yf_short.get("short_volume"),
                    "days_to_cover": yf_short.get("days_to_cover"),
                    "short_status": "ok",
                    "short_source": "yfinance",
                }
            )

    if meta.get("analyst_upgrade_score") is None:
        proxy = _yfinance_analyst_consensus_score(tk)
        if proxy:
            meta.update(proxy)

    meta.setdefault("ticker", tk)
    return meta


# Backward-compatible alias
TIER1_ANALYSTS = frozenset(t.lower() for t in TIER1_FIRMS)


__all__ = [
    "TIER1_ANALYSTS",
    "TIER1_FIRMS",
    "analyst_score_from_grades",
    "collect_fmp_cluster_b",
    "compute_days_to_cover",
    "fetch_analyst_grades_fmp",
    "fetch_institutional_13f_fmp",
    "fetch_short_interest_fmp",
    "fetch_short_interest_yfinance",
    "fmp_api_key",
    "is_tier1_firm",
    "load_cached_cluster_b",
    "refresh_cluster_b_resilient",
]
