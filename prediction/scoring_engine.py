"""
Supernova composite stock scoring engine (-100 to +100) with BUY/HOLD/SELL labels.

Usage:
    from prediction.scoring_engine import score_stock, ScoringInput

    result = score_stock("TLX", ScoringInput(closes=[...], ...))
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from typing import Any, Mapping, Sequence

from prediction.phase_pos import get_phase_pos
from prediction.technicals import (
    atr14,
    atr14_from_closes,
    bollinger_bands,
    linear_regression_slope_pct,
    return_pct,
    rsi14,
    sma,
    slope_pct,
)

# ── Configurable weights (raw spec sums to 110% — normalized to 1.0) ───────────
_RAW_WEIGHTS: dict[str, float] = {
    "momentum": 0.20,
    "slope": 0.15,
    "beta": 0.10,
    "rsi": 0.10,
    "atr": 0.05,
    "volume_ratio": 0.10,
    "short_interest": 0.10,
    "bollinger": 0.05,
    "xbi_rs": 0.05,
    "cash_runway": 0.05,
    "catalyst_proximity": 0.10,
    "phase_probability": 0.05,
}
_wsum = sum(_RAW_WEIGHTS.values())
WEIGHTS: dict[str, float] = {k: v / _wsum for k, v in _RAW_WEIGHTS.items()}

COMPONENT_MAX: dict[str, float] = {
    "momentum": 20.0,
    "slope": 15.0,
    "beta": 10.0,
    "rsi": 10.0,
    "atr": 5.0,
    "volume_ratio": 10.0,
    "short_interest": 10.0,
    "bollinger": 5.0,
    "xbi_rs": 5.0,
    "cash_runway": 5.0,
    "catalyst_proximity": 10.0,
    "phase_probability": 5.0,
}

RECOMMENDATION_THRESHOLDS = (
    (60.0, "STRONG BUY"),
    (30.0, "BUY"),
    (-30.0, "HOLD"),
    (-60.0, "SELL"),
    (float("-inf"), "STRONG SELL"),
)

RECOMMENDATION_COLORS: dict[str, dict[str, str]] = {
    "STRONG BUY": {
        "hex": "#16a34a",
        "tailwind_bg": "bg-green-100",
        "tailwind_text": "text-green-600",
        "badge_style": "background:#dcfce7;color:#16a34a;border:1px solid #16a34a40",
    },
    "BUY": {
        "hex": "#4ade80",
        "tailwind_bg": "bg-green-50",
        "tailwind_text": "text-green-400",
        "badge_style": "background:#f0fdf4;color:#4ade80;border:1px solid #4ade8040",
    },
    "HOLD": {
        "hex": "#facc15",
        "tailwind_bg": "bg-yellow-50",
        "tailwind_text": "text-yellow-400",
        "badge_style": "background:#fefce8;color:#ca8a04;border:1px solid #facc1540",
    },
    "SELL": {
        "hex": "#f97316",
        "tailwind_bg": "bg-orange-50",
        "tailwind_text": "text-orange-400",
        "badge_style": "background:#fff7ed;color:#f97316;border:1px solid #f9731640",
    },
    "STRONG SELL": {
        "hex": "#dc2626",
        "tailwind_bg": "bg-red-100",
        "tailwind_text": "text-red-600",
        "badge_style": "background:#fee2e2;color:#dc2626;border:1px solid #dc262640",
    },
}

OVERRIDE_COLORS: dict[str, str] = {
    "PRE-CATALYST LOCK": "#9333ea",
    "POST-EVENT DISLOCATION": "#3b82f6",
    "CASH CRISIS": "#171717",
}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _lin_map(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    if x1 == x0:
        return y0
    t = _clamp((x - x0) / (x1 - x0), 0.0, 1.0)
    return y0 + t * (y1 - y0)


@dataclass
class ScoringInput:
    """Per-ticker inputs. All fields optional except ticker context via closes."""

    closes: Sequence[float] = field(default_factory=list)
    volumes: Sequence[float] = field(default_factory=list)
    highs: Sequence[float] = field(default_factory=list)
    lows: Sequence[float] = field(default_factory=list)
    beta: float | None = None
    xbi_closes: Sequence[float] = field(default_factory=list)
    short_interest_pct: float | None = None
    days_to_cover: float | None = None
    cash_runway_months: float | None = None
    catalyst_days_to_event: int | None = None
    post_event_drop_pct: float | None = None
    price_drop_48h_pct: float | None = None
    clinical_phase_num: int | None = None
    phase_success_prob: float | None = None
    has_near_term_catalyst: bool | None = None


@dataclass
class ScoringResult:
    ticker: str
    composite_score: float
    recommendation: str
    override_flag: str | None
    component_scores: dict[str, float | None]
    signal_summary: str
    confidence_score: float
    color: dict[str, str]
    override_color: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _momentum_score(closes: Sequence[float]) -> float | None:
    if len(closes) < 50:
        return None
    price = closes[-1]
    s20 = sma(closes, 20)
    s50 = sma(closes, 50)
    if s20 is None or s50 is None or price <= 0:
        return None
    mx = COMPONENT_MAX["momentum"]
    if price > s20 > s50:
        return mx
    if price > s20 and s20 <= s50:
        return mx * 0.55
    if price < s20 < s50:
        return -mx
    if price < s20 and s20 >= s50:
        return -mx * 0.55
    if price > s20:
        return mx * 0.25
    if price < s20:
        return -mx * 0.25
    return 0.0


def _slope_score(closes: Sequence[float]) -> float | None:
    sp = slope_pct(closes, 20)
    lr = linear_regression_slope_pct(closes, 20)
    if sp is None and lr is None:
        return None
    ref = sp if sp is not None else (lr or 0) * 20
    mx = COMPONENT_MAX["slope"]
    return round(_clamp(ref / 30.0, -1.0, 1.0) * mx, 2)


def _beta_score(beta: float | None, momentum_sign: float) -> float | None:
    if beta is None or not momentum_sign:
        return None if beta is None else 0.0
    mx = COMPONENT_MAX["beta"]
    amp = _clamp(beta / 1.5, 0.5, 2.0)
    sign = 1.0 if momentum_sign > 0 else -1.0
    return round(sign * amp * (mx / 2.0), 2)


def _rsi_score(closes: Sequence[float]) -> float | None:
    r = rsi14(closes)
    if r is None:
        return None
    mx = COMPONENT_MAX["rsi"]
    if r <= 30:
        return _lin_map(r, 20, 30, mx * 0.5, mx)
    if r >= 70:
        return _lin_map(r, 70, 80, -mx * 0.5, -mx)
    if r < 50:
        return _lin_map(r, 30, 50, mx * 0.3, 0)
    return _lin_map(r, 50, 70, 0, -mx * 0.3)


def _atr_score(closes: Sequence[float], highs: Sequence[float], lows: Sequence[float], mom: float) -> float | None:
    if len(closes) < 15:
        return None
    a = atr14(highs, lows, closes) if highs and lows else atr14_from_closes(closes)
    if a is None or closes[-1] <= 0:
        return None
    atr_pct = a / closes[-1] * 100.0
    mx = COMPONENT_MAX["atr"]
    if atr_pct > 8:
        return -mx
    if atr_pct < 4 and mom > 0:
        return _lin_map(atr_pct, 0, 4, mx * 0.6, mx * 0.2)
    if atr_pct < 4:
        return mx * 0.15
    return _lin_map(atr_pct, 4, 8, 0, -mx * 0.5)


def _volume_ratio_score(closes: Sequence[float], volumes: Sequence[float], mom: float) -> float | None:
    if len(volumes) < 20:
        return None
    avg20 = sum(volumes[-20:]) / 20.0
    today = volumes[-1]
    if avg20 <= 0:
        return None
    ratio = today / avg20
    mx = COMPONENT_MAX["volume_ratio"]
    if ratio >= 2.0 and mom > 0:
        return mx
    if ratio >= 2.0 and mom < 0:
        return -mx * 0.8
    if ratio >= 1.5:
        return mx * 0.5 * (1 if mom >= 0 else -1)
    if ratio < 0.7:
        return -mx * 0.3
    return 0.0


def _short_interest_score(
    si_pct: float | None,
    dtc: float | None,
    mom: float,
    has_catalyst: bool,
) -> float | None:
    if si_pct is None:
        return None
    mx = COMPONENT_MAX["short_interest"]
    amp = 1.0 + (0.25 * _clamp((dtc or 0) / 5.0, 0, 1))
    if si_pct > 20 and mom > 0:
        return round(_clamp(mx * 0.85 * amp, 0, mx), 2)
    if si_pct > 30 and not has_catalyst:
        return round(-mx * amp, 2)
    if si_pct > 15 and mom < 0:
        return round(-mx * 0.5, 2)
    return 0.0


def _bollinger_score(closes: Sequence[float], mom: float) -> float | None:
    _, _, _, width = bollinger_bands(closes, 20)
    if width is None:
        return None
    mx = COMPONENT_MAX["bollinger"]
    if width < 0.10:
        return round((1 if mom >= 0 else -1) * mx * 0.8, 2)
    return 0.0


def _xbi_rs_score(closes: Sequence[float], xbi_closes: Sequence[float]) -> float | None:
    rs = return_pct(closes, 20)
    xbi = return_pct(xbi_closes, 20)
    if rs is None or xbi is None:
        return None
    diff = rs - xbi
    mx = COMPONENT_MAX["xbi_rs"]
    return round(_clamp(diff / 15.0, -1.0, 1.0) * mx, 2)


def _cash_runway_score(months: float | None) -> float | None:
    if months is None:
        return None
    mx = COMPONENT_MAX["cash_runway"]
    if months >= 18:
        return mx * 0.4
    if months >= 6:
        return _lin_map(months, 6, 18, -mx * 0.4, mx * 0.2)
    if months >= 3:
        return _lin_map(months, 3, 6, -mx, -mx * 0.4)
    return -mx


def _catalyst_proximity_score(
    days: int | None,
    post_drop: float | None,
) -> float | None:
    if days is None:
        return None
    mx = COMPONENT_MAX["catalyst_proximity"]
    if days <= 30:
        return mx * 0.85
    if days <= 90:
        return mx * 0.4
    if post_drop is not None and post_drop < -15:
        return -mx * 0.5
    return 0.0


def _phase_probability_score(ph_num: int | None, pos: float | None) -> float | None:
    p = pos if pos is not None else get_phase_pos(ph_num)
    if p is None:
        return None
    mx = COMPONENT_MAX["phase_probability"]
    return round(_clamp((p - 0.5) * 2.0, -1.0, 1.0) * mx, 2)


def _recommendation_from_score(score: float) -> str:
    if score > 60:
        return "STRONG BUY"
    if score > 30:
        return "BUY"
    if score >= -30:
        return "HOLD"
    if score >= -60:
        return "SELL"
    return "STRONG SELL"


def _apply_overrides(
    score: float,
    rec: str,
    data: ScoringInput,
    vol_ratio: float | None,
) -> tuple[str, str | None]:
    override: str | None = None
    if data.cash_runway_months is not None and data.cash_runway_months < 3:
        override = "CASH CRISIS"
        rec = "STRONG SELL" if score < -30 else "SELL"
    elif data.catalyst_days_to_event is not None and data.catalyst_days_to_event <= 14:
        override = "PRE-CATALYST LOCK"
        rec = "HOLD"
    elif (
        data.price_drop_48h_pct is not None
        and data.price_drop_48h_pct < -20
        and vol_ratio is not None
        and vol_ratio > 3
    ):
        override = "POST-EVENT DISLOCATION"
    return rec, override


def _signal_summary(
    ticker: str,
    score: float,
    rec: str,
    components: dict[str, float | None],
    override: str | None,
) -> str:
    parts: list[str] = []
    top = sorted(
        [(k, v) for k, v in components.items() if v is not None],
        key=lambda kv: abs(kv[1]),
        reverse=True,
    )[:3]
    drivers = ", ".join(f"{k.replace('_', ' ')} {v:+.1f}" for k, v in top) if top else "limited data"
    parts.append(f"{ticker} composite {score:+.0f} → {rec}.")
    parts.append(f"Main drivers: {drivers}.")
    if override == "PRE-CATALYST LOCK":
        parts.append("Pre-event binary risk — recommendation suspended to HOLD.")
    elif override == "CASH CRISIS":
        parts.append("Runway under 3 months — dilution/bankruptcy risk dominates.")
    elif override == "POST-EVENT DISLOCATION":
        parts.append("Sharp post-event drop on heavy volume — potential overreaction; manual review suggested.")
    return " ".join(parts)


def _aggregate_score(raw_components: dict[str, float | None]) -> tuple[float, float]:
    """Weighted sum with proportional redistribution for missing components."""
    available = {k: v for k, v in raw_components.items() if v is not None}
    if not available:
        return 0.0, 0.0
    weight_sum = sum(WEIGHTS[k] for k in available)
    if weight_sum <= 0:
        return 0.0, 0.0
    total = sum((WEIGHTS[k] / weight_sum) * v for k, v in available.items())
    confidence = round(len(available) / len(WEIGHTS) * 100.0, 1)
    return round(_clamp(total, -100.0, 100.0), 2), confidence


def compute_component_scores(data: ScoringInput) -> dict[str, float | None]:
    closes = list(data.closes)
    mom_raw = _momentum_score(closes) if closes else None
    mom_sign = mom_raw if mom_raw is not None else (_slope_score(closes) or 0)

    vol_ratio: float | None = None
    if len(data.volumes) >= 20:
        avg20 = sum(data.volumes[-20:]) / 20.0
        if avg20 > 0:
            vol_ratio = data.volumes[-1] / avg20

    has_cat = data.has_near_term_catalyst
    if has_cat is None and data.catalyst_days_to_event is not None:
        has_cat = data.catalyst_days_to_event <= 90

    return {
        "momentum": mom_raw,
        "slope": _slope_score(closes) if closes else None,
        "beta": _beta_score(data.beta, mom_sign),
        "rsi": _rsi_score(closes) if closes else None,
        "atr": _atr_score(closes, list(data.highs), list(data.lows), mom_sign) if closes else None,
        "volume_ratio": _volume_ratio_score(closes, list(data.volumes), mom_sign),
        "short_interest": _short_interest_score(
            data.short_interest_pct,
            data.days_to_cover,
            mom_sign,
            bool(has_cat),
        ),
        "bollinger": _bollinger_score(closes, mom_sign) if closes else None,
        "xbi_rs": _xbi_rs_score(closes, list(data.xbi_closes)),
        "cash_runway": _cash_runway_score(data.cash_runway_months),
        "catalyst_proximity": _catalyst_proximity_score(
            data.catalyst_days_to_event,
            data.post_event_drop_pct,
        ),
        "phase_probability": _phase_probability_score(
            data.clinical_phase_num,
            data.phase_success_prob,
        ),
    }


def score_stock(ticker: str, data: ScoringInput) -> ScoringResult:
    """Score a single ticker. Primary public API."""
    components = compute_component_scores(data)
    composite, confidence = _aggregate_score(components)
    rec = _recommendation_from_score(composite)

    vol_ratio: float | None = None
    if len(data.volumes) >= 20:
        avg20 = sum(data.volumes[-20:]) / 20.0
        if avg20 > 0:
            vol_ratio = data.volumes[-1] / avg20

    rec, override = _apply_overrides(composite, rec, data, vol_ratio)
    summary = _signal_summary(ticker, composite, rec, components, override)
    color = dict(RECOMMENDATION_COLORS.get(rec, RECOMMENDATION_COLORS["HOLD"]))
    override_color = OVERRIDE_COLORS.get(override) if override else None

    return ScoringResult(
        ticker=ticker.upper(),
        composite_score=composite,
        recommendation=rec,
        override_flag=override,
        component_scores=components,
        signal_summary=summary,
        confidence_score=confidence,
        color=color,
        override_color=override_color,
    )


def fetch_short_float_fmp(ticker: str, api_key: str | None = None) -> dict[str, float | None]:
    """Short float via FMP with yfinance fallback. Returns {short_interest_pct, days_to_cover}."""
    from prediction.sds_data_collector import fetch_short_interest_fmp

    doc = fetch_short_interest_fmp(ticker, api_key=api_key, use_cache=True)
    return {
        "short_interest_pct": doc.get("short_interest_pct"),
        "days_to_cover": doc.get("days_to_cover"),
    }


def build_scoring_input_from_series(
    closes: Sequence[float],
    volumes: Sequence[float] | None = None,
    *,
    beta: float | None = None,
    xbi_closes: Sequence[float] | None = None,
    short_interest_pct: float | None = None,
    days_to_cover: float | None = None,
    cash_runway_months: float | None = None,
    catalyst_days_to_event: int | None = None,
    post_event_drop_pct: float | None = None,
    price_drop_48h_pct: float | None = None,
    clinical_phase_num: int | None = None,
    phase_success_prob: float | None = None,
) -> ScoringInput:
    """Helper to assemble ScoringInput from pipeline series."""
    p48: float | None = price_drop_48h_pct
    if p48 is None and len(closes) >= 3:
        p0 = closes[-3]
        p1 = closes[-1]
        if p0 > 0:
            p48 = round((p1 / p0 - 1.0) * 100.0, 2)
    return ScoringInput(
        closes=list(closes),
        volumes=list(volumes or []),
        beta=beta,
        xbi_closes=list(xbi_closes or []),
        short_interest_pct=short_interest_pct,
        days_to_cover=days_to_cover,
        cash_runway_months=cash_runway_months,
        catalyst_days_to_event=catalyst_days_to_event,
        post_event_drop_pct=post_event_drop_pct,
        price_drop_48h_pct=p48,
        clinical_phase_num=clinical_phase_num,
        phase_success_prob=phase_success_prob,
    )
