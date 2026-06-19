"""
Assemble ScoringInput from Supernova on-disk caches (price, enrich, simulation).
"""
from __future__ import annotations

import json
import os
import pickle
from datetime import date, datetime
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR
from prediction.scoring_engine import ScoringInput, build_scoring_input_from_series, score_stock

_PRICE_CACHE = Path(DATA_DIR) / "price_cache"
_ENRICH_CACHE = Path(DATA_DIR) / "enrich_cache"
_SIM_SNAP = Path(DATA_DIR) / "simulation_sheet_snapshot.json"


def _parse_cd_days(cd_raw: Any) -> int | None:
    if cd_raw is None:
        return None
    s = str(cd_raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            d = datetime.strptime(s, fmt).date()
            return (d - date.today()).days
        except ValueError:
            continue
    return None


def _values_from_pickle_field(raw: Any) -> list[float]:
    """Normalize list/Series/ndarray from price_cache pickles."""
    if raw is None:
        return []
    if hasattr(raw, "tolist"):
        raw = raw.tolist()
    elif not isinstance(raw, (list, tuple)):
        try:
            raw = list(raw)
        except TypeError:
            return []
    out: list[float] = []
    for x in raw:
        if x is None:
            continue
        try:
            fv = float(x)
        except (TypeError, ValueError):
            continue
        if fv == fv:  # skip NaN
            out.append(fv)
    return out


def _pick_close_volume(obj: Any) -> tuple[list[float], list[float]]:
    if isinstance(obj, dict):
        c_raw = obj.get("close")
        if c_raw is None:
            c_raw = obj.get("Close")
        v_raw = obj.get("volume")
        if v_raw is None:
            v_raw = obj.get("Volume")
        return _values_from_pickle_field(c_raw), _values_from_pickle_field(v_raw)
    if isinstance(obj, (list, tuple)) and len(obj) >= 1:
        closes = _values_from_pickle_field(obj[0])
        vols = _values_from_pickle_field(obj[1]) if len(obj) > 1 else []
        return closes, vols
    # pandas DataFrame (e.g. _IDX_XBI_5y.pkl)
    cols = getattr(obj, "columns", None)
    if cols is not None:
        col_names = [str(c) for c in cols]
        close_col = next(
            (c for c in ("close", "Close", "XBI", "Adj Close") if c in col_names),
            col_names[0] if col_names else None,
        )
        vol_col = next((c for c in ("volume", "Volume") if c in col_names), None)
        closes = _values_from_pickle_field(obj[close_col]) if close_col else []
        vols = _values_from_pickle_field(obj[vol_col]) if vol_col else []
        return closes, vols
    return [], []


def load_price_series(ticker: str, period: str = "60d") -> tuple[list[float], list[float]]:
    """Load close/volume from price_cache pickle."""
    tk = ticker.upper().replace(".", "-")
    for suffix in (f"{period}_cv.pkl", f"{period}.pkl", "5y_cv.pkl", "5y.pkl"):
        path = _PRICE_CACHE / f"{tk}_{suffix}"
        if not path.is_file():
            continue
        try:
            with path.open("rb") as fh:
                obj = pickle.load(fh)
            closes_f, vols_f = _pick_close_volume(obj)
            if len(closes_f) >= 20:
                return closes_f, vols_f
        except Exception:
            continue
    return [], []


def _yfinance_backfill_enabled() -> bool:
    v = os.environ.get("SDS_PRICE_YFINANCE_BACKFILL", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _fetch_yfinance_cv(ticker: str, *, period: str = "2y") -> tuple[list[float], list[float]]:
    """Download OHLCV from Yahoo when price_cache is missing or too short."""
    tk = ticker.upper().replace(".", "-")
    try:
        import yfinance as yf
    except ImportError:
        return [], []
    try:
        raw = yf.download(
            tk,
            period=period,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if raw is None or getattr(raw, "empty", True):
            return [], []
        close_col = raw["Close"] if "Close" in raw.columns else raw.iloc[:, 0]
        vol_col = raw["Volume"] if "Volume" in raw.columns else None
        closes = _values_from_pickle_field(close_col.tolist() if hasattr(close_col, "tolist") else close_col)
        vols = _values_from_pickle_field(vol_col.tolist() if vol_col is not None and hasattr(vol_col, "tolist") else vol_col)
        return closes, vols
    except Exception:
        return [], []


def _save_price_cv_pickle(ticker: str, closes: list[float], vols: list[float], period: str = "5y") -> None:
    if len(closes) < 20:
        return
    try:
        import pandas as pd
    except ImportError:
        return
    tk = ticker.upper().replace(".", "-")
    _PRICE_CACHE.mkdir(parents=True, exist_ok=True)
    path = _PRICE_CACHE / f"{tk}_{period}_cv.pkl"
    try:
        close_s = pd.Series(closes, dtype=float)
        vol_s = pd.Series(vols, dtype=float) if len(vols) == len(closes) else pd.Series([0.0] * len(closes))
        pd.to_pickle({"close": close_s, "volume": vol_s}, path)
    except Exception:
        pass


def ensure_price_series(
    ticker: str,
    *,
    min_bars: int = 126,
    persist: bool = True,
) -> tuple[list[float], list[float]]:
    """
    Load price history for SDS cluster C, backfilling from Yahoo when cache is short.
    Prefers 5y pickle, falls back to 60d, then live yfinance (optionally persisted).
    """
    closes, vols = load_price_series(ticker, "5y")
    if len(closes) < 60:
        c60, v60 = load_price_series(ticker, "60d")
        if len(c60) > len(closes):
            closes, vols = c60, v60

    if len(closes) < min_bars and _yfinance_backfill_enabled():
        yf_c, yf_v = _fetch_yfinance_cv(ticker, period="2y" if min_bars <= 126 else "5y")
        if len(yf_c) > len(closes):
            closes, vols = yf_c, yf_v
            if persist:
                _save_price_cv_pickle(ticker, closes, vols, period="5y")

    return closes, vols


def ensure_xbi_closes(*, min_bars: int = 90, persist: bool = True) -> list[float]:
    """XBI benchmark closes for relative-strength; backfills ^XBI when cache missing."""
    for period in ("5y", "60d"):
        c = load_xbi_closes(period)
        if len(c) >= min_bars:
            return c
    best = load_xbi_closes("5y") or load_xbi_closes("60d")
    if len(best) >= min_bars:
        return best
    if _yfinance_backfill_enabled():
        yf_c, yf_v = _fetch_yfinance_cv("^XBI", period="2y")
        if len(yf_c) >= min_bars:
            if persist:
                _save_price_cv_pickle("^XBI", yf_c, yf_v, period="5y")
            return yf_c
        if len(yf_c) > len(best):
            return yf_c
    return best


_XBI_CACHE_ALIASES = ("_IDX_XBI", "^XBI", "XBI")


def load_xbi_closes(period: str = "60d") -> list[float]:
    for sym in _XBI_CACHE_ALIASES:
        c, _ = load_price_series(sym, period)
        if c:
            return c
    return []


def load_enrich(ticker: str) -> dict[str, Any]:
    path = _ENRICH_CACHE / f"{ticker.upper()}.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _runway_from_enrich(enrich: dict[str, Any]) -> float | None:
    """Estimate cash runway months from cash + operating cash flow if present."""
    cash = enrich.get("total_cash") or enrich.get("cash")
    ocf = enrich.get("operating_cash_flow") or enrich.get("operatingCashflow")
    if cash is not None:
        try:
            cash_f = float(cash)
        except (TypeError, ValueError):
            cash_f = None
        else:
            if ocf is not None:
                try:
                    ocf_f = float(ocf)
                    if ocf_f < 0:
                        monthly_burn = abs(ocf_f) / 12.0
                        if monthly_burn > 0:
                            return round(cash_f / monthly_burn, 1)
                except (TypeError, ValueError):
                    pass
            # cash present but no burn estimate — liquidity proxy
            liq = enrich.get("liquidity_score")
            if liq is not None:
                try:
                    return round(6 + float(liq) * 24, 1)
                except (TypeError, ValueError):
                    pass
    # no cash field: still use liquidity_score when enrich has it
    liq = enrich.get("liquidity_score")
    if liq is not None:
        try:
            ls = float(liq)
            return round(6 + ls * 24, 1)
        except (TypeError, ValueError):
            pass
    return None


def market_cap_from_enrich(enrich: dict[str, Any]) -> float | None:
    """Best-effort market cap from enrich cache."""
    for key in ("market_cap", "marketCap", "market_capitalization"):
        v = enrich.get(key)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    ev = enrich.get("enterpriseValue") or enrich.get("enterprise_value")
    if ev is not None:
        try:
            return float(ev)
        except (TypeError, ValueError):
            pass
    price = enrich.get("currentPrice") or enrich.get("current_price")
    shares = enrich.get("sharesOutstanding") or enrich.get("shares_outstanding")
    if price is not None and shares is not None:
        try:
            return float(price) * float(shares)
        except (TypeError, ValueError):
            pass
    return None


def sim_row_for_ticker(ticker: str) -> dict[str, Any] | None:
    if not _SIM_SNAP.is_file():
        return None
    try:
        snap = json.loads(_SIM_SNAP.read_text(encoding="utf-8"))
        rows = snap.get("rows") or []
    except (OSError, json.JSONDecodeError):
        return None
    tk = ticker.upper()
    for row in rows:
        if str(row.get("Ticker") or row.get("ticker") or "").upper() == tk:
            return row
    return None


def build_scoring_input_for_ticker(
    ticker: str,
    *,
    fetch_short: bool = False,
) -> ScoringInput:
    closes, vols = load_price_series(ticker)
    xbi = load_xbi_closes()
    enrich = load_enrich(ticker)
    row = sim_row_for_ticker(ticker)

    beta = enrich.get("beta")
    try:
        beta_f = float(beta) if beta is not None else None
    except (TypeError, ValueError):
        beta_f = None

    cd_days = None
    ph_num = None
    if row:
        cd_days = _parse_cd_days(row.get("Completion Date") or row.get("CD"))
        ph_raw = row.get("Phase") or row.get("Clinical Phase")
        if ph_raw:
            import re

            m = re.search(r"(\d)", str(ph_raw))
            if m:
                ph_num = int(m.group(1))

    si_pct = None
    dtc = None
    if fetch_short:
        from prediction.scoring_engine import fetch_short_float_fmp

        sf = fetch_short_float_fmp(ticker)
        si_pct = sf.get("short_interest_pct")
        dtc = sf.get("days_to_cover")

    return build_scoring_input_from_series(
        closes,
        vols,
        beta=beta_f,
        xbi_closes=xbi,
        short_interest_pct=si_pct,
        days_to_cover=dtc,
        cash_runway_months=_runway_from_enrich(enrich),
        catalyst_days_to_event=cd_days,
        clinical_phase_num=ph_num,
    )


def score_ticker_from_cache(ticker: str, *, fetch_short: bool = False) -> dict[str, Any]:
    data = build_scoring_input_for_ticker(ticker, fetch_short=fetch_short)
    return score_stock(ticker, data).to_dict()
