"""
Market Context Score (MCS) — 0-100 external market inflection signal.

High MCS (>65): move likely driven by external sector/macro stress → favor HOLD.
Low MCS (<35): idiosyncratic move → EXIT more justified.
35-65: ambiguous.

Component weights (total): sector 40%, macro 30%, breadth 20%, FDA 10%.
Per-ticker rolling corr (sector sub-component 1c) is computed client-side when
ticker prices are available.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import MARKET_CONTEXT_SNAPSHOT_JSON, REGULATORY_RISK_SNAPSHOT_JSON
from prediction.market_context_fetcher import (
    MARKET_TICKERS,
    closes_by_date,
    fetch_market_context_series,
)

logger = logging.getLogger(__name__)

# SOGLIA_PROVVISORIA — normalization ranges (not final calibrated thresholds)
XBI_SLOPE_RANGE_PCT = 10.0
RATIO_SLOPE_RANGE_PCT = 5.0
VIX_CALM = 15.0
VIX_EXTREME = 40.0
FDA_CRL_MAX_30D = 5

MCS_WEIGHTS = {
    "sector": 0.40,
    "macro": 0.30,
    "breadth": 0.20,
    "fda": 0.10,
}

SECTOR_SUB_WEIGHTS = {
    "xbi_slope": 0.375,  # 15% of total MCS
    "ratio_slope": 0.375,
    # corr_20d (10% total) — computed per ticker in TS
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _pct_return(closes: dict[str, float], end_date: str, days: int) -> float | None:
    dates = sorted(closes.keys())
    if end_date not in closes:
        return None
    try:
        end_idx = dates.index(end_date)
    except ValueError:
        return None
    start_idx = end_idx - days
    if start_idx < 0:
        return None
    old = closes[dates[start_idx]]
    new = closes[end_date]
    if old <= 0:
        return None
    return (new - old) / old * 100.0


def _rolling_mean_std(values: list[float], window: int) -> tuple[float | None, float | None]:
    if len(values) < window:
        return None, None
    tail = values[-window:]
    mean = sum(tail) / len(tail)
    if len(tail) < 2:
        return mean, None
    var = sum((x - mean) ** 2 for x in tail) / (len(tail) - 1)
    return mean, math.sqrt(var) if var > 0 else 0.0


def score_xbi_slope_5d(xbi_slope_5d: float | None) -> float | None:
    if xbi_slope_5d is None:
        return None
    # SOGLIA_PROVVISORIA: -10% → 100, +10% → 0
    return round(_clamp((-xbi_slope_5d + XBI_SLOPE_RANGE_PCT) / (2 * XBI_SLOPE_RANGE_PCT) * 100, 0, 100), 2)


def score_ratio_slope_5d(ratio_slope_pct: float | None) -> float | None:
    if ratio_slope_pct is None:
        return None
    # SOGLIA_PROVVISORIA: -5% ratio decline → 100
    return round(_clamp((-ratio_slope_pct + RATIO_SLOPE_RANGE_PCT) / (2 * RATIO_SLOPE_RANGE_PCT) * 100, 0, 100), 2)


def score_vix_level(vix: float | None) -> float | None:
    if vix is None:
        return None
    # SOGLIA_PROVVISORIA: VIX 15→0, 40→100
    return round(_clamp((vix - VIX_CALM) / (VIX_EXTREME - VIX_CALM) * 100, 0, 100), 2)


def score_hyg_lqd_spread(
    lqd_closes: dict[str, float],
    hyg_closes: dict[str, float],
    end_date: str,
) -> float | None:
    dates = sorted(set(lqd_closes.keys()) & set(hyg_closes.keys()))
    if end_date not in dates:
        return None
    spreads: list[float] = []
    spread_dates: list[str] = []
    for d in dates:
        hyg = hyg_closes.get(d)
        lqd = lqd_closes.get(d)
        if hyg and hyg > 0 and lqd:
            spreads.append(lqd / hyg)
            spread_dates.append(d)
    if end_date not in spread_dates:
        return None
    end_idx = spread_dates.index(end_date)
    hist = spreads[: end_idx + 1]
    spread_today = hist[-1]
    mean, std = _rolling_mean_std(hist, min(20, len(hist)))
    if mean is None:
        return None
    if std is None or std <= 1e-9:
        z = 0.0
    else:
        z = (spread_today - mean) / std
    return round(_clamp(z * 25 + 50, 0, 100), 2)


def score_breadth_proxy(xbi_closes: dict[str, float], end_date: str) -> float | None:
    """PROXY_SEMPLIFICATO: sostituire con vera breadth % quando disponibile."""
    dates = sorted(xbi_closes.keys())
    if end_date not in dates:
        return None
    end_idx = dates.index(end_date)
    hist = [xbi_closes[d] for d in dates[: end_idx + 1]]
    if len(hist) < 50:
        return None
    ma50 = sum(hist[-50:]) / 50
    close = hist[-1]
    if close < ma50 * 0.99:
        return 70.0
    if close > ma50 * 1.01:
        return 30.0
    return 50.0


def count_crl_last_30_days() -> tuple[int | None, str]:
    """
  Count CRL signals for FDA sentiment component.
  Uses regulatory_risk_snapshot — proxy by active CRL detections when event dates
  are unavailable. Returns (count, data_quality tag).
  """
    p = Path(REGULATORY_RISK_SNAPSHOT_JSON)
    if not p.is_file():
        return None, "reg_snapshot_missing"
    try:
        snap = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, "reg_snapshot_unreadable"

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    dated_count = 0
    has_any_date = False
    tickers = snap.get("tickers") or {}
    for entry in tickers.values():
        crl = entry.get("crl") or {}
        if not crl.get("detected"):
            continue
        sources = crl.get("sources") or []
        for src in sources:
            if not isinstance(src, dict):
                continue
            raw_dt = src.get("date") or src.get("published") or src.get("filing_date")
            if not raw_dt:
                continue
            has_any_date = True
            try:
                dt = datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt >= cutoff:
                    dated_count += 1
                    break
            except ValueError:
                continue

    if has_any_date:
        return dated_count, "crl_dated_sources"

    proxy = sum(1 for e in tickers.values() if (e.get("crl") or {}).get("detected"))
    return proxy, "proxy_active_crl_tickers"


def score_fda_sentiment(crl_30d: int | None, quality: str) -> tuple[float, str]:
    """
  FDA component: 50 = genuinely unknown (documented exception to no-silent-fallback).
  """
    if crl_30d is None:
        return 50.0, "neutral_unknown"
    # SOGLIA_PROVVISORIA: 5 CRL in 30d → 100
    return round(_clamp(crl_30d / FDA_CRL_MAX_30D * 100, 0, 100), 2), quality


def _blend_parts(parts: dict[str, float | None]) -> tuple[float | None, dict[str, float], list[str]]:
    active = {k: v for k, v in parts.items() if v is not None and math.isfinite(v)}
    if not active:
        return None, {}, []
    raw_sum = sum(MCS_WEIGHTS[k] for k in active)
    weights_used = {k: MCS_WEIGHTS[k] / raw_sum for k in active}
    score = sum(active[k] * weights_used[k] for k in active)
    return round(score, 2), weights_used, list(active.keys())


def _blend_sector_sub(parts: dict[str, float | None]) -> tuple[float | None, list[str]]:
    active = {k: v for k, v in parts.items() if v is not None and math.isfinite(v)}
    if not active:
        return None, []
    raw = sum(SECTOR_SUB_WEIGHTS[k] for k in active)
    w = {k: SECTOR_SUB_WEIGHTS[k] / raw for k in active}
    val = sum(active[k] * w[k] for k in active)
    return round(val, 2), list(active.keys())


def compute_mcs_for_date(
    series: dict[str, list[dict[str, Any]] | None],
    as_of_date: str,
    *,
    fda_score: float,
    fda_quality: str,
) -> dict[str, Any]:
    xbi = closes_by_date(series.get("XBI"))
    spy = closes_by_date(series.get("SPY"))
    vix = closes_by_date(series.get("^VIX"))
    hyg = closes_by_date(series.get("HYG"))
    lqd = closes_by_date(series.get("LQD"))

    xbi_slope = _pct_return(xbi, as_of_date, 5)
    xbi_slope_score = score_xbi_slope_5d(xbi_slope)

    ratio_slope_pct: float | None = None
    ratio_score: float | None = None
    if as_of_date in xbi and as_of_date in spy:
        ratio_now = xbi[as_of_date] / spy[as_of_date] if spy[as_of_date] > 0 else None
        dates = sorted(set(xbi.keys()) & set(spy.keys()))
        if ratio_now is not None and as_of_date in dates:
            idx = dates.index(as_of_date)
            if idx >= 5:
                d5 = dates[idx - 5]
                if spy.get(d5, 0) > 0:
                    ratio_5d = xbi[d5] / spy[d5]
                    if ratio_5d > 0:
                        ratio_slope_pct = (ratio_now - ratio_5d) / ratio_5d * 100
                        ratio_score = score_ratio_slope_5d(ratio_slope_pct)

    sector_sub, sector_sub_used = _blend_sector_sub(
        {
            "xbi_slope": xbi_slope_score,
            "ratio_slope": ratio_score,
        }
    )

    vix_level = vix.get(as_of_date)
    vix_score = score_vix_level(vix_level)
    spread_score = score_hyg_lqd_spread(lqd, hyg, as_of_date)
    macro_parts = {"vix": vix_score, "spread": spread_score}
    macro_active = {k: v for k, v in macro_parts.items() if v is not None and math.isfinite(v)}
    if macro_active:
        raw = sum(0.5 for _ in macro_active)
        macro_sub = round(sum(v * (0.5 / raw) for v in macro_active.values()), 2)
        macro_sub_used = list(macro_active.keys())
    else:
        macro_sub = None
        macro_sub_used = []

    breadth_score = score_breadth_proxy(xbi, as_of_date)

    mcs_global, weights_used, components_used = _blend_parts(
        {
            "sector": sector_sub,
            "macro": macro_sub,
            "breadth": breadth_score,
            "fda": fda_score,
        }
    )

    sector_ok = series.get("XBI") is not None and series.get("SPY") is not None
    macro_ok = series.get("^VIX") is not None and series.get("HYG") is not None and series.get("LQD") is not None

    return {
        "date": as_of_date,
        "mcs_global": mcs_global,
        "components": {
            "sector": {
                "score": sector_sub,
                "xbi_slope_5d_pct": round(xbi_slope, 3) if xbi_slope is not None else None,
                "xbi_slope_score": xbi_slope_score,
                "ratio_slope_5d_pct": round(ratio_slope_pct, 3) if ratio_slope_pct is not None else None,
                "ratio_score": ratio_score,
                "subcomponents_used": sector_sub_used,
            },
            "macro": {
                "score": macro_sub,
                "vix_level": round(vix_level, 2) if vix_level is not None else None,
                "vix_score": vix_score,
                "spread_score": spread_score,
                "subcomponents_used": macro_sub_used,
            },
            "breadth": {
                "score": breadth_score,
                "proxy": True,  # PROXY_SEMPLIFICATO
            },
            "fda": {
                "score": fda_score,
                "data_quality": fda_quality,
            },
        },
        "weights_used": weights_used,
        "components_used": components_used,
        "data_quality": {
            "sector": "full_data" if sector_ok and sector_sub is not None else ("null" if not sector_ok else "partial"),
            "macro": "full_data" if macro_ok and macro_sub is not None else ("null" if not macro_ok else "partial"),
            "breadth": "proxy_semplificato" if breadth_score is not None else "null",
            "fda": fda_quality,
        },
    }


def build_history(
    series: dict[str, list[dict[str, Any]] | None],
    *,
    days: int = 30,
) -> list[dict[str, Any]]:
    xbi_bars = series.get("XBI") or []
    if not xbi_bars:
        return []
    dates = sorted({str(b["date"]) for b in xbi_bars})[-days:]
    crl_count, crl_quality = count_crl_last_30_days()
    fda_score, fda_q = score_fda_sentiment(crl_count, crl_quality)
    return [compute_mcs_for_date(series, d, fda_score=fda_score, fda_quality=fda_q) for d in dates]


def load_previous_snapshot(path: Path | str | None = None) -> dict[str, Any] | None:
    p = Path(path or MARKET_CONTEXT_SNAPSHOT_JSON)
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def merge_series_on_failure(
    fresh: dict[str, list[dict[str, Any]] | None],
    previous: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]] | None]:
    """Keep last valid bars per ticker when fresh fetch fails."""
    if not previous:
        return fresh
    prev_series = previous.get("series") or {}
    out = dict(fresh)
    for ticker in MARKET_TICKERS:
        if out.get(ticker):
            continue
        stale = prev_series.get(ticker)
        if stale:
            out[ticker] = stale
            logger.warning("[MCS] using stale series for %s", ticker)
    return out


def compute_stale_days(last_ok: str | None) -> int:
    if not last_ok:
        return 999
    try:
        dt = datetime.fromisoformat(last_ok.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
        return max(0, delta.days)
    except ValueError:
        return 999


def build_market_context_snapshot(
    *,
    history_days: int = 30,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = _now_iso()
    fetch_errors: dict[str, str] = {}
    fresh = fetch_market_context_series()
    for ticker, bars in fresh.items():
        if bars is None:
            fetch_errors[ticker] = "fetch_failed"

    series = merge_series_on_failure(fresh, previous)
    any_fresh = any(fresh.get(t) for t in MARKET_TICKERS)
    all_fresh = all(fresh.get(t) for t in MARKET_TICKERS)

    if all_fresh:
        update_status = "ok"
        last_successful_update = now
    elif any_fresh:
        update_status = "partial"
        last_successful_update = previous.get("last_successful_update") if previous else None
        if all_fresh:
            last_successful_update = now
    else:
        update_status = "failed"
        last_successful_update = previous.get("last_successful_update") if previous else None

    if all_fresh:
        last_successful_update = now
    elif previous and not any_fresh:
        last_successful_update = previous.get("last_successful_update")

    history = build_history(series, days=history_days)
    latest = history[-1] if history else None

    stale_days = 0 if all_fresh else compute_stale_days(last_successful_update)

    return {
        "version": 1,
        "updated_at": now,
        "last_successful_update": last_successful_update,
        "update_status": update_status,
        "stale_days": stale_days,
        "fetch_errors": fetch_errors,
        "tickers_fetched": list(MARKET_TICKERS),
        "series": series,
        "history": history,
        "latest": latest,
    }


def save_market_context_snapshot(doc: dict[str, Any], path: Path | str | None = None) -> Path:
    p = Path(path or MARKET_CONTEXT_SNAPSHOT_JSON)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return p


def load_market_context_snapshot(path: Path | str | None = None) -> dict[str, Any]:
    prev = load_previous_snapshot(path)
    return prev or {
        "version": 1,
        "update_status": "missing",
        "stale_days": 999,
        "history": [],
        "latest": None,
        "series": {},
    }
