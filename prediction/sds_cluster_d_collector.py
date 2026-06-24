"""
Cluster D fundamentals collector — cash runway (SEC / Yahoo / FMP) + cached metadata.

Caches in ``data/sds_fundamentals_cache.json``:
  - runway: ~90 day TTL (aligned with 10-Q)
  - mc_pipeline inputs: ~7 day TTL
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from orchestrator_io_paths import DATA_DIR

_FUND_CACHE_PATH = Path(DATA_DIR) / "sds_fundamentals_cache.json"
_RUNWAY_TTL_D = 90.0
_MC_TTL_D = 7.0


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


def _load_cache() -> dict[str, Any]:
    if not _FUND_CACHE_PATH.is_file():
        return {"tickers": {}}
    try:
        doc = json.loads(_FUND_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"tickers": {}}
    if not isinstance(doc, dict):
        return {"tickers": {}}
    doc.setdefault("tickers", {})
    return doc


def _save_cache(doc: dict[str, Any]) -> None:
    _FUND_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = dict(doc)
    out["updated_at"] = _now_iso()
    _FUND_CACHE_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def _get_section(ticker: str, section: str) -> dict[str, Any] | None:
    tk = ticker.upper()
    sec = (_load_cache().get("tickers") or {}).get(tk, {}).get(section)
    return sec if isinstance(sec, dict) else None


def _set_section(ticker: str, section: str, payload: dict[str, Any]) -> None:
    tk = ticker.upper()
    doc = _load_cache()
    entry = doc.setdefault("tickers", {}).setdefault(tk, {})
    entry[section] = dict(payload)
    _save_cache(doc)


def _fmp_api_key() -> str | None:
    for env in ("FMP_API_KEY", "FINANCIAL_MODELING_PREP_API_KEY"):
        v = os.environ.get(env, "").strip()
        if v:
            return v
    return None


def _fmp_get(path: str) -> Any:
    key = _fmp_api_key()
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


def _float_or_none(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        v = float(raw)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def compute_runway_months(
    cash_and_equivalents: float | None,
    *,
    short_term_investments: float | None = None,
    operating_expenses_quarterly: float | None = None,
    revenue_quarterly: float | None = None,
) -> dict[str, Any]:
    """Compute runway from quarterly SEC-style inputs."""
    if cash_and_equivalents is None:
        return {
            "runway_months": None,
            "total_cash": None,
            "net_burn_monthly": None,
            "status": "cash_data_unavailable",
        }

    total_cash = float(cash_and_equivalents) + float(short_term_investments or 0.0)
    opex = float(operating_expenses_quarterly or 0.0)
    rev = max(float(revenue_quarterly or 0.0), 0.0)
    net_burn_q = opex - rev
    net_burn_monthly = net_burn_q / 3.0

    if net_burn_monthly <= 0:
        runway = 999.0
    else:
        runway = total_cash / net_burn_monthly
        if runway > 100:
            runway = 999.0

    return {
        "runway_months": round(runway, 1),
        "total_cash": total_cash,
        "net_burn_monthly": net_burn_monthly,
        "net_burn_quarterly": net_burn_q,
        "status": "ok",
    }


def fetch_runway_yfinance(ticker: str) -> dict[str, Any]:
    """Latest quarter cash + burn from Yahoo Finance financials."""
    tk = ticker.upper()
    out: dict[str, Any] = {"ticker": tk, "source": "yfinance", "fetched_at": _now_iso()}
    try:
        import yfinance as yf

        t = yf.Ticker(tk)
        cash: float | None = None
        st_inv: float | None = None
        opex_q: float | None = None
        rev_q: float | None = None

        bs = t.quarterly_balance_sheet
        if bs is not None and not bs.empty:
            for row in (
                "Cash And Cash Equivalents",
                "Cash Cash Equivalents And Short Term Investments",
            ):
                if row in bs.index:
                    cash = _float_or_none(bs.loc[row].iloc[0])
                    if cash is not None:
                        break
            for row in ("Short Term Investments", "Other Short Term Investments"):
                if row in bs.index:
                    st_inv = _float_or_none(bs.loc[row].iloc[0])
                    if st_inv is not None:
                        break

        inc = t.quarterly_income_stmt
        if inc is not None and not inc.empty:
            for row in ("Operating Expense", "Total Expenses", "Operating Expenses"):
                if row in inc.index:
                    opex_q = _float_or_none(inc.loc[row].iloc[0])
                    if opex_q is not None:
                        break
            for row in ("Total Revenue", "Revenue"):
                if row in inc.index:
                    rev_q = _float_or_none(inc.loc[row].iloc[0])
                    if rev_q is not None:
                        break

        if cash is None:
            info = t.info if isinstance(getattr(t, "info", None), dict) else {}
            cash = _float_or_none(info.get("totalCash"))

        runway_doc = compute_runway_months(
            cash,
            short_term_investments=st_inv,
            operating_expenses_quarterly=opex_q,
            revenue_quarterly=rev_q,
        )
        out.update(
            {
                "cash_and_equivalents": cash,
                "short_term_investments": st_inv,
                "operating_expenses_quarterly": opex_q,
                "revenue_quarterly": rev_q,
                **runway_doc,
            }
        )
        if cash is None:
            out["status"] = "cash_data_unavailable"
        return out
    except Exception as exc:
        out["status"] = "cash_data_unavailable"
        out["error"] = str(exc)[:120]
        return out


def fetch_runway_fmp(ticker: str) -> dict[str, Any]:
    """FMP balance sheet + income statement (quarterly)."""
    tk = ticker.upper()
    out: dict[str, Any] = {"ticker": tk, "source": "fmp", "fetched_at": _now_iso()}
    bs_rows = _fmp_get(f"/api/v3/balance-sheet-statement/{tk}?limit=4")
    inc_rows = _fmp_get(f"/api/v3/income-statement/{tk}?period=quarter&limit=4")
    if not isinstance(bs_rows, list) or not bs_rows or not isinstance(inc_rows, list) or not inc_rows:
        out["status"] = "cash_data_unavailable"
        return out

    bs = bs_rows[0] if isinstance(bs_rows[0], dict) else {}
    inc = inc_rows[0] if isinstance(inc_rows[0], dict) else {}
    cash = _float_or_none(
        bs.get("cashAndCashEquivalents")
        or bs.get("cashAndShortTermInvestments")
        or bs.get("cash")
    )
    st_inv = _float_or_none(bs.get("shortTermInvestments"))
    opex_q = _float_or_none(
        inc.get("operatingExpenses")
        or inc.get("totalExpenses")
        or inc.get("operatingExpense")
    )
    rev_q = _float_or_none(inc.get("revenue") or inc.get("totalRevenue"))

    runway_doc = compute_runway_months(
        cash,
        short_term_investments=st_inv,
        operating_expenses_quarterly=opex_q,
        revenue_quarterly=rev_q,
    )
    out.update(
        {
            "cash_and_equivalents": cash,
            "short_term_investments": st_inv,
            "operating_expenses_quarterly": opex_q,
            "revenue_quarterly": rev_q,
            **runway_doc,
        }
    )
    if cash is None:
        out["status"] = "cash_data_unavailable"
    return out


def fetch_runway_data(ticker: str, *, use_cache: bool = True, force_refresh: bool = False) -> dict[str, Any]:
    """Runway fundamentals with cache → yfinance → FMP."""
    tk = ticker.upper()
    if use_cache and not force_refresh:
        cached = _get_section(tk, "runway")
        if cached and _is_fresh(cached.get("fetched_at"), _RUNWAY_TTL_D):
            return cached

    doc = fetch_runway_yfinance(tk)
    if doc.get("status") != "ok" and _fmp_api_key():
        fmp_doc = fetch_runway_fmp(tk)
        if fmp_doc.get("status") == "ok":
            doc = fmp_doc

    if use_cache:
        _set_section(tk, "runway", doc)
    return doc


def load_cached_cluster_d(ticker: str) -> dict[str, Any] | None:
    tk = ticker.upper()
    runway = _get_section(tk, "runway")
    if runway and not _is_fresh(runway.get("fetched_at"), _RUNWAY_TTL_D):
        runway = None
    if not runway:
        return None
    return {"ticker": tk, **runway, "from_cache": True}


def collect_cluster_d(
    ticker: str,
    *,
    use_cache: bool = True,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Cash runway metadata for Cluster D scoring."""
    runway = fetch_runway_data(ticker, use_cache=use_cache, force_refresh=force_refresh)
    return {
        "ticker": ticker.upper(),
        "cash_and_equivalents": runway.get("cash_and_equivalents"),
        "short_term_investments": runway.get("short_term_investments"),
        "operating_expenses_quarterly": runway.get("operating_expenses_quarterly"),
        "revenue_quarterly": runway.get("revenue_quarterly"),
        "runway_months": runway.get("runway_months"),
        "total_cash": runway.get("total_cash"),
        "net_burn_monthly": runway.get("net_burn_monthly"),
        "runway_status": runway.get("status"),
        "runway_source": runway.get("source"),
    }


__all__ = [
    "collect_cluster_d",
    "compute_runway_months",
    "fetch_runway_data",
    "fetch_runway_fmp",
    "fetch_runway_yfinance",
    "load_cached_cluster_d",
]
