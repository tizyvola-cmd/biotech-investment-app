"""
Supernova Distance Score (SDS) — measures proximity to historical supernova setups.

SDS 0–100: distance from conditions that precede extraordinary pre-CD surges.
Does NOT predict the surge; operational threshold SDS ≥ 70 = supernova zone.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Sequence

from prediction.technicals import linear_regression_slope_pct, return_pct

ZoneLabel = Literal["SUPERNOVA ZONE", "CANDIDATE", "WATCH", "DISTANT"]
VetoCode = Literal[
    "CASH_CRISIS",
    "MARKET_CRISIS",
    "BINARY_EVENT_LOCK",
    None,
]


@dataclass
class SdsTickerInput:
    ticker: str
    closes: list[float] = field(default_factory=list)
    volumes: list[float] = field(default_factory=list)
    xbi_closes: list[float] = field(default_factory=list)
    days_to_cd: int | None = None
    phase: str | None = None
    primary_outcome: str | None = None
    primary_outcomes: list[str] = field(default_factory=list)
    trial_design: str | None = None
    study_description: str | None = None
    indication: str | None = None
    condition: str | None = None
    intervention_name: str | None = None
    intervention_description: str | None = None
    market_cap: float | None = None
    cash_runway_months: float | None = None
    institutional_delta: float | None = None
    institutional_delta_pct: float | None = None
    short_interest_pct: float | None = None
    days_to_cover: float | None = None
    analyst_upgrade_score: float | None = None
    cluster_b_meta: dict[str, Any] = field(default_factory=dict)
    unmet_need: float | None = None
    market_size: float | None = None
    first_in_class: bool | None = None
    first_in_class_confidence: str | None = None
    approved_drugs_count: int | None = None
    pipeline_value_estimate: float | None = None
    catalyst_types_90d: list[str] = field(default_factory=list)
    volume_ratio_5d: float | None = None
    pred5_live: float | None = None
    confidence_score: float | None = None
    market_regime: str | None = None
    phase_probability: float | None = None
    cluster_d_meta: dict[str, Any] = field(default_factory=dict)
    cluster_e_meta: dict[str, Any] = field(default_factory=dict)
    cd_date: str | None = None
    catalyst_events_90d: list[dict[str, Any]] = field(default_factory=list)
    ma_attractiveness: float = 0.0


@dataclass
class SdsResult:
    ticker: str
    sds: float
    zone_label: ZoneLabel
    zone_color: str
    zone_action: str
    veto: VetoCode
    recommendation: str | None = None
    cluster_scores: dict[str, float] = field(default_factory=dict)
    component_raw: dict[str, float | None] = field(default_factory=dict)
    missing_data_pct: float = 0.0
    coverage_fields: dict[str, bool] = field(default_factory=dict)
    missing_data: dict[str, str] = field(default_factory=dict)
    cluster_a: dict[str, Any] = field(default_factory=dict)
    cluster_b: dict[str, Any] = field(default_factory=dict)
    cluster_c: dict[str, Any] = field(default_factory=dict)
    cluster_d: dict[str, Any] = field(default_factory=dict)
    cluster_e: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_indication(condition: str | None) -> str:
    if not condition:
        return ""
    s = str(condition).strip().lower()
    s = re.sub(r"[^\w\s-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _normalize_phase_text(phase: str) -> str:
    p = phase.strip().lower().replace("_", " ")
    p = re.sub(r"\s+", " ", p)
    p = p.replace("phase3", "phase 3").replace("phase2", "phase 2").replace("phase1", "phase 1")
    return p


_PHASE_BASE_ORDER: list[tuple[str, float, str]] = [
    ("phase 3 pivotal", 10.0, "Phase 3 pivotal"),
    ("phase 2/phase 3", 6.0, "Phase 2/Phase 3"),
    ("phase 1b/phase 2", 2.0, "Phase 1b/Phase 2"),
    ("phase 1/phase 2", 2.0, "Phase 1/Phase 2"),
    ("phase 3", 7.0, "Phase 3"),
    ("phase 2b", 5.0, "Phase 2b"),
    ("phase 2a", 3.0, "Phase 2a"),
    ("phase 2", 4.0, "Phase 2"),
]

_ENDPOINT_RULES: list[tuple[int, str, tuple[str, ...]]] = [
    (10, "OS", ("overall survival", " os ", " os,", "survival rate")),
    (9, "Biopsy/Histology", ("biopsy", "histolog", "histopath", "nash resolution")),
    (
        8,
        "PFS/EFS",
        (
            "progression-free survival",
            "pfs",
            "event-free survival",
            "efs",
            "relapse-free survival",
            "disease-free survival",
        ),
    ),
    (
        7,
        "CR/pCR",
        ("complete response", "complete remission", "cr rate", "pathological complete"),
    ),
    (
        6,
        "ORR",
        ("objective response rate", "orr", "overall response", "response rate", "tumor response"),
    ),
    (
        5,
        "TTP/TTR",
        ("time to progression", "time to response", "duration of response"),
    ),
    (4, "CBR/DCR", ("clinical benefit", "disease control", "dcr")),
    (3, "Biomarker/Imaging", ("biomarker", "pharmacodynamic", "pd marker", "imaging", "pdff", "mri")),
    (2, "PRO/QoL", ("patient reported", "pro ", "quality of life", "qol", "symptom score")),
]

MARKET_SIZE_ESTIMATES: dict[str, float] = {
    "nash": 8.0,
    "non-alcoholic steatohepatitis": 8.0,
    "rheumatoid arthritis": 6.0,
    "psoriasis": 5.0,
    "colorectal cancer": 4.5,
    "breast cancer": 7.0,
    "lung cancer": 9.0,
    "multiple myeloma": 6.0,
    "aml": 3.0,
    "acute myeloid leukemia": 3.0,
    "schizophrenia": 4.0,
    "bipolar": 3.5,
    "agitation": 2.0,
    "polycythemia vera": 1.5,
    "alopecia areata": 2.5,
    "atopic dermatitis": 5.0,
    "crohn": 4.0,
    "ulcerative colitis": 4.0,
    "alzheimer": 10.0,
    "obesity": 12.0,
    "diabetes": 8.0,
    "ovarian cancer": 3.0,
    "prostate cancer": 5.0,
    "melanoma": 4.0,
}


def phase_credibility_detail(
    phase: str | None,
    study_design: str | None = None,
    primary_outcome: str | None = None,
    *,
    primary_outcomes: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Phase credibility 0–14 with bonus breakdown."""
    flags: list[str] = []
    if not phase or not str(phase).strip():
        return {
            "score": 0.0,
            "max": 14,
            "phase_detected": None,
            "base": 0.0,
            "bonuses": [],
            "flags": ["phase_data_missing"],
        }

    p_norm = _normalize_phase_text(str(phase))
    design = (study_design or "").lower()
    po = (primary_outcome or "").lower()
    bonuses: list[str] = []

    base = 0.0
    phase_detected = str(phase).strip()
    if "pivotal" in design or "pivotal" in p_norm:
        base = 10.0
        phase_detected = "Phase 3 pivotal"
    else:
        p_compact = p_norm.replace(" ", "")
        for key, score, label in _PHASE_BASE_ORDER:
            key_compact = key.replace(" ", "")
            if key_compact in p_compact or key in p_norm:
                if score > base:
                    base = score
                    phase_detected = label
        if base == 0.0:
            if "phase 3" in p_norm:
                base = 7.0
                phase_detected = "Phase 3"
            else:
                m = re.search(r"phase\s*(\d)", p_norm)
                if m:
                    n = int(m.group(1))
                    base = {1: 1.0, 2: 4.0, 3: 7.0}.get(n, 0.0)
                    phase_detected = f"Phase {n}"

    base_before_bonus = base
    if "placebo" in design:
        base += 1.0
        bonuses.append("placebo_controlled")
    if "randomized" in design and ("double blind" in design.replace("-", " ") or "double_blind" in design):
        base += 1.0
        bonuses.append("randomized_double_blind")

    po_list = list(primary_outcomes or [])
    if not po_list and primary_outcome:
        po_list = [s.strip() for s in re.split(r"[|;]", primary_outcome) if s.strip()]
    if len(po_list) >= 2:
        base += 2.0
        bonuses.append("dual_primary_endpoint")
    if any(k in po for k in ("biopsy", "histolog", "histopath")):
        base += 2.0
        bonuses.append("histology_endpoint")

    score = min(base, 14.0)
    return {
        "score": score,
        "max": 14,
        "phase_detected": phase_detected,
        "base": base_before_bonus,
        "bonuses": bonuses,
        "flags": flags,
    }


def phase_credibility_score(
    phase: str | None,
    trial_design: str | None = None,
    primary_outcome: str | None = None,
    *,
    primary_outcomes: Sequence[str] | None = None,
) -> float:
    return float(phase_credibility_detail(phase, trial_design, primary_outcome, primary_outcomes=primary_outcomes)["score"])


def _match_endpoint(text: str) -> tuple[int, str, str]:
    t = f" {text.lower()} "
    for pts, label, keywords in _ENDPOINT_RULES:
        for kw in keywords:
            if kw in t or kw in text.lower():
                return pts, label, kw
    return 1, "Other", "fallback"


def endpoint_credibility_detail(
    primary_outcome: str | None,
    study_description: str | None = None,
) -> dict[str, Any]:
    flags: list[str] = []
    text = (primary_outcome or "").strip()
    source = "primary_outcome"
    if not text:
        text = (study_description or "").strip()
        source = "study_description" if text else "none"
    if not text:
        return {
            "score": 3.0,
            "max": 10,
            "endpoint_type": "Inferred",
            "keyword_matched": None,
            "source": source,
            "flags": ["endpoint_inferred"],
        }

    pts, label, kw = _match_endpoint(text)
    if pts == 1 and source == "study_description":
        flags.append("endpoint_inferred")
    return {
        "score": float(min(pts, 10)),
        "max": 10,
        "endpoint_type": label,
        "keyword_matched": kw if kw != "fallback" else None,
        "source": source,
        "flags": flags,
    }


def endpoint_credibility_score(
    primary_outcome: str | None,
    study_description: str | None = None,
) -> float:
    return float(endpoint_credibility_detail(primary_outcome, study_description)["score"])


def unmet_need_detail(
    approved_count: int | None,
    first_in_class: bool | None = None,
    *,
    confidence: str | None = None,
) -> dict[str, Any]:
    if approved_count is None:
        return {
            "score": None,
            "max": 13,
            "approved_drugs_count": None,
            "first_in_class": first_in_class,
            "confidence": confidence,
            "base": None,
            "bonus": 0.0,
            "flags": ["openfda_missing"],
        }

    n = int(approved_count)
    if n == 0:
        base = 10.0
    elif n <= 2:
        base = 7.0
    elif n <= 5:
        base = 4.0
    else:
        base = 1.0

    conf = (confidence or "").strip().lower()
    bonus = 3.0 if first_in_class is True and conf in ("high", "medium") else 0.0
    if first_in_class is True and not conf:
        bonus = 3.0

    return {
        "score": min(base + bonus, 13.0),
        "max": 13,
        "approved_drugs_count": n,
        "first_in_class": first_in_class,
        "confidence": confidence,
        "base": base,
        "bonus": bonus,
        "flags": [],
    }


def unmet_need_score(
    approved_count: int | None,
    first_in_class: bool | None = None,
    *,
    confidence: str | None = None,
) -> float | None:
    detail = unmet_need_detail(approved_count, first_in_class, confidence=confidence)
    sc = detail.get("score")
    return float(sc) if sc is not None else None


def market_size_detail(
    condition: str | None,
    *,
    tam_billions: float | None = None,
) -> dict[str, Any]:
    key = normalize_indication(condition)
    tam = tam_billions
    source = "lookup_table" if tam is None else "override"
    flags: list[str] = []

    if tam is None and key:
        for k, v in MARKET_SIZE_ESTIMATES.items():
            if k in key:
                tam = v
                source = "lookup_table"
                break

    if tam is None:
        tam = 1.5
        source = "estimated_default"
        flags.append("market_size_estimated")

    if tam > 8:
        score = 10.0
    elif tam > 5:
        score = 8.0
    elif tam > 3:
        score = 6.0
    elif tam > 1:
        score = 3.0
    else:
        score = 1.0

    return {
        "score": score,
        "max": 10,
        "tam_estimate_bn": tam,
        "source": source,
        "flags": flags,
    }


def market_size_score(indication: str | None, tam_billions: float | None = None) -> float:
    return float(market_size_detail(indication, tam_billions=tam_billions)["score"])


def compute_cluster_a(inp: SdsTickerInput) -> tuple[float, dict[str, Any]]:
    """Cluster A raw sum (max 47) and debug breakdown."""
    condition = inp.condition or inp.indication
    phase_d = phase_credibility_detail(
        inp.phase,
        inp.trial_design,
        inp.primary_outcome,
        primary_outcomes=inp.primary_outcomes,
    )
    endpoint_d = endpoint_credibility_detail(inp.primary_outcome, inp.study_description)
    unmet_d = unmet_need_detail(
        inp.approved_drugs_count if inp.approved_drugs_count is not None else None,
        inp.first_in_class,
        confidence=inp.first_in_class_confidence,
    )
    market_d = market_size_detail(condition)

    phase_sc = float(phase_d["score"])
    endpoint_sc = float(endpoint_d["score"])
    unmet_sc = float(unmet_d["score"]) if unmet_d.get("score") is not None else 0.0
    market_sc = float(market_d["score"])

    a_raw = phase_sc + endpoint_sc + unmet_sc + market_sc
    cluster_a_scaled = a_raw / 47.0 * 30.0

    breakdown = {
        "total": round(cluster_a_scaled, 1),
        "raw_total": round(a_raw, 1),
        "raw_max": 47,
        "phase_credibility": phase_d,
        "endpoint_credibility": endpoint_d,
        "unmet_need": unmet_d,
        "market_size": market_d,
    }
    return a_raw, breakdown


def _population_stdev(values: Sequence[float]) -> float:
    n = len(values)
    if n <= 0:
        return 0.0
    mean = sum(values) / n
    return math.sqrt(sum((x - mean) ** 2 for x in values) / n)


def _bb_width_from_closes(closes_20: Sequence[float]) -> float | None:
    """Bollinger band width ratio: (upper − lower) / middle for a 20-day window."""
    if len(closes_20) < 20:
        return None
    window = [float(x) for x in closes_20[-20:]]
    middle = sum(window) / 20.0
    if middle <= 0:
        return None
    std = _population_stdev(window)
    upper = middle + 2.0 * std
    lower = middle - 2.0 * std
    return (upper - lower) / middle


def _rolling_bb_widths(closes: Sequence[float], *, lookback: int = 126) -> list[float]:
    """BB width for each of the last ``lookback`` trading days (inclusive of today)."""
    if len(closes) < 20:
        return []
    end = len(closes) - 1
    start = max(19, end - lookback + 1)
    widths: list[float] = []
    for i in range(start, end + 1):
        w = _bb_width_from_closes(closes[i - 19 : i + 1])
        if w is not None and math.isfinite(w) and w > 0:
            widths.append(float(w))
    return widths


def _pctile_rank(history: Sequence[float], value: float) -> float | None:
    vals = [float(x) for x in history if x is not None and math.isfinite(float(x))]
    if not vals:
        return None
    below = sum(1 for v in vals if v <= value)
    return 100.0 * below / len(vals)


def _linregress_slope(values: Sequence[float]) -> float | None:
    n = len(values)
    if n < 2:
        return None
    x_mean = (n - 1) / 2.0
    y = [float(v) for v in values]
    y_mean = sum(y) / n
    num = sum((i - x_mean) * (y[i] - y_mean) for i in range(n))
    den = sum((i - x_mean) ** 2 for i in range(n))
    if den == 0:
        return None
    return num / den


def _return_over_index(closes: Sequence[float], lookback: int) -> float | None:
    """Return (close[-1] − close[-lookback]) / close[-lookback] with len ≥ lookback."""
    if len(closes) < lookback:
        return None
    start = float(closes[-lookback])
    end = float(closes[-1])
    if start <= 0:
        return None
    return (end - start) / start


def _bb_interpretation(percentile: float) -> str:
    if percentile < 10:
        return "extreme compression"
    if percentile < 35:
        return "moderate compression"
    return "normal"


def bollinger_squeeze_detail(
    closes: Sequence[float],
    *,
    lookback: int = 126,
) -> dict[str, Any]:
    """Bollinger band width percentile vs history (score 0–10).

    Uses 126d when available; falls back to 90d / 60d with shorter rolling window.
    """
    base: dict[str, Any] = {"score": 0.0, "max": 10, "bb_width_today": None, "bb_percentile": None, "interpretation": "normal"}
    if not closes:
        return {**base, "flag": "no_price_data", "status": "no_price_data"}

    effective_lookback = lookback
    if len(closes) < lookback:
        for alt in (90, 60):
            if len(closes) >= alt:
                effective_lookback = alt
                break
        else:
            return {**base, "flag": "insufficient_history", "status": "insufficient_history"}

    bb_history = _rolling_bb_widths(closes, lookback=effective_lookback)
    if len(bb_history) < 2:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    width_today = bb_history[-1]
    pct = _pctile_rank(bb_history, width_today)
    if pct is None:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    if pct < 10:
        score = 10.0
    elif pct < 20:
        score = 8.0
    elif pct < 35:
        score = 5.0
    elif pct < 50:
        score = 2.0
    else:
        score = 0.0
    out = {
        "score": score,
        "max": 10,
        "bb_width_today": round(width_today, 4),
        "bb_percentile": round(pct, 1),
        "interpretation": _bb_interpretation(pct),
        "status": "ok",
    }
    if effective_lookback != lookback:
        out["lookback_days"] = effective_lookback
        out["lookback_note"] = f"adaptive_{effective_lookback}d"
    return out


def bb_squeeze_score(
    closes: Sequence[float],
    *,
    lookback: int = 126,
) -> tuple[float, float | None, str | None]:
    """Returns (score 0–10, bb_width_percentile, missing_reason)."""
    d = bollinger_squeeze_detail(closes, lookback=lookback)
    miss = d.get("flag") if d.get("status") != "ok" else None
    return float(d["score"]), d.get("bb_percentile"), miss


def obv_accumulation_detail(closes: Sequence[float], volumes: Sequence[float]) -> dict[str, Any]:
    """On-balance volume pattern vs price slope (score 0–8)."""
    base: dict[str, Any] = {
        "score": 0.0,
        "max": 8,
        "obv_slope": None,
        "price_slope_pct_day": None,
        "pattern": "downtrend",
    }
    if not closes or not volumes:
        return {**base, "flag": "no_price_data", "status": "no_price_data"}
    if len(closes) < 20 or len(volumes) < 20:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    n = min(len(closes), len(volumes))
    obv: list[float] = [0.0]
    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            obv.append(obv[-1] + float(volumes[i]))
        elif closes[i] < closes[i - 1]:
            obv.append(obv[-1] - float(volumes[i]))
        else:
            obv.append(obv[-1])
    obv_20 = obv[-20:]
    closes_20 = [float(c) for c in closes[-20:]]
    obv_slope = _linregress_slope(obv_20)
    price_slope = _linregress_slope(closes_20)
    if obv_slope is None or price_slope is None or closes_20[0] <= 0:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    price_slope_pct = price_slope / closes_20[0] * 100.0
    obv_rising = obv_slope > 0
    price_flat = abs(price_slope_pct) < 0.3
    price_rising = price_slope_pct > 0.3
    price_falling = price_slope_pct < -0.3
    if obv_rising and price_flat:
        score, pattern = 8.0, "accumulation"
    elif obv_rising and price_rising:
        score, pattern = 5.0, "confirmed_uptrend"
    elif obv_rising and price_falling:
        score, pattern = 6.0, "bullish_divergence"
    elif not obv_rising and price_rising:
        score, pattern = 1.0, "weak_rally"
    elif not obv_rising and price_flat:
        score, pattern = 0.0, "distribution"
    else:
        score, pattern = 0.0, "downtrend"
    return {
        "score": score,
        "max": 8,
        "obv_slope": round(obv_slope, 0),
        "price_slope_pct_day": round(price_slope_pct, 3),
        "pattern": pattern,
        "status": "ok",
    }


def obv_accumulation_score(closes: Sequence[float], volumes: Sequence[float]) -> tuple[float, str | None]:
    d = obv_accumulation_detail(closes, volumes)
    miss = d.get("flag") if d.get("status") != "ok" else None
    return float(d["score"]), miss


def xbi_relative_strength_detail(closes: Sequence[float], xbi_closes: Sequence[float]) -> dict[str, Any]:
    """Relative strength vs XBI — 70% long window + 30% short window (score −2 to 5)."""
    base: dict[str, Any] = {
        "score": 0.0,
        "max": 5,
        "rs_90d": None,
        "rs_20d": None,
        "ticker_return_90d": None,
        "xbi_return_90d": None,
        "interpretation": "in-line",
    }
    if not closes or not xbi_closes:
        return {**base, "flag": "no_price_data", "status": "no_price_data"}

    long_win = 90
    if len(closes) < long_win or len(xbi_closes) < long_win:
        for alt in (60, 45):
            if len(closes) >= alt and len(xbi_closes) >= alt:
                long_win = alt
                break
        else:
            return {**base, "flag": "insufficient_history", "status": "insufficient_history"}

    short_win = min(20, long_win // 2)
    ticker_return_long = _return_over_index(closes, long_win)
    xbi_return_long = _return_over_index(xbi_closes, long_win)
    ticker_return_short = _return_over_index(closes, short_win)
    xbi_return_short = _return_over_index(xbi_closes, short_win)
    if None in (ticker_return_long, xbi_return_long, ticker_return_short, xbi_return_short):
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    rs_long = ticker_return_long - xbi_return_long
    rs_short = ticker_return_short - xbi_return_short
    rs_combined = rs_long * 0.7 + rs_short * 0.3
    if rs_combined > 0.20:
        score = 5.0
    elif rs_combined > 0.10:
        score = 4.0
    elif rs_combined > 0.03:
        score = 3.0
    elif rs_combined > -0.03:
        score = 1.0
    elif rs_combined > -0.10:
        score = 0.0
    else:
        score = -2.0
    if rs_combined > 0.03:
        interpretation = "outperforming"
    elif rs_combined > -0.03:
        interpretation = "in-line"
    else:
        interpretation = "underperforming"
    out = {
        "score": score,
        "max": 5,
        "rs_90d": round(rs_long * 100.0, 1),
        "rs_20d": round(rs_short * 100.0, 1),
        "ticker_return_90d": round(ticker_return_long * 100.0, 1),
        "xbi_return_90d": round(xbi_return_long * 100.0, 1),
        "rs_combined": round(rs_combined * 100.0, 1),
        "interpretation": interpretation,
        "status": "ok",
    }
    if long_win != 90:
        out["window_days"] = long_win
        out["window_note"] = f"adaptive_{long_win}d"
    return out


def xbi_rs_90d_score(closes: Sequence[float], xbi_closes: Sequence[float]) -> tuple[float, str | None]:
    d = xbi_relative_strength_detail(closes, xbi_closes)
    miss = d.get("flag") if d.get("status") != "ok" else None
    return float(d["score"]), miss


def volume_ratio_detail(volumes: Sequence[float]) -> dict[str, Any]:
    """5-day vs 20-day average volume (score −1 to 5)."""
    base: dict[str, Any] = {
        "score": 0.0,
        "max": 5,
        "ratio_5d_vs_20d": None,
        "ratio_today_vs_20d": None,
        "avg_volume_5d": None,
        "avg_volume_20d": None,
        "interpretation": "normal",
    }
    if not volumes:
        return {**base, "flag": "no_price_data", "status": "no_price_data"}
    if len(volumes) < 25:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    vols = [float(v) for v in volumes]
    avg_5d = sum(vols[-5:]) / 5.0
    avg_20d = sum(vols[-20:]) / 20.0
    if avg_20d <= 0:
        return {**base, "flag": "insufficient_history", "status": "insufficient_history"}
    ratio_5_20 = avg_5d / avg_20d
    ratio_today = vols[-1] / avg_20d
    if ratio_5_20 > 2.5:
        score = 5.0
    elif ratio_5_20 > 1.8:
        score = 4.0
    elif ratio_5_20 > 1.3:
        score = 3.0
    elif ratio_5_20 > 1.0:
        score = 1.0
    elif ratio_5_20 > 0.7:
        score = 0.0
    else:
        score = -1.0
    if ratio_5_20 > 1.8:
        interpretation = "high activity"
    elif ratio_5_20 > 0.7:
        interpretation = "normal"
    else:
        interpretation = "low activity"
    return {
        "score": score,
        "max": 5,
        "ratio_5d_vs_20d": round(ratio_5_20, 2),
        "ratio_today_vs_20d": round(ratio_today, 2),
        "avg_volume_5d": int(avg_5d),
        "avg_volume_20d": int(avg_20d),
        "interpretation": interpretation,
        "status": "ok",
    }


def volume_ratio_component_score(volumes: Sequence[float]) -> tuple[float, str | None]:
    d = volume_ratio_detail(volumes)
    miss = d.get("flag") if d.get("status") != "ok" else None
    return float(d["score"]), miss


def _cluster_c_missing_from_breakdown(breakdown: dict[str, Any]) -> dict[str, str]:
    key_map = {
        "bollinger_squeeze": "bb_squeeze",
        "obv_accumulation": "obv_accumulation",
        "xbi_relative_strength": "xbi_rs_90d",
        "volume_ratio": "volume_ratio",
    }
    out: dict[str, str] = {}
    for comp_key, raw_key in key_map.items():
        comp = breakdown.get(comp_key) or {}
        flag = comp.get("flag") or comp.get("status")
        if flag in ("insufficient_history", "no_price_data"):
            out[raw_key] = str(flag)
    return out


def compute_cluster_c(inp: SdsTickerInput) -> tuple[float, dict[str, Any]]:
    """Cluster C — price structure from OHLCV + XBI closes (no external APIs)."""
    if not inp.closes or not inp.volumes:
        empty = {
            "total": 0.0,
            "raw_total": 0.0,
            "raw_max": 28.0,
            "bollinger_squeeze": bollinger_squeeze_detail([]),
            "obv_accumulation": obv_accumulation_detail([], []),
            "xbi_relative_strength": xbi_relative_strength_detail([], inp.xbi_closes or []),
            "volume_ratio": volume_ratio_detail([]),
        }
        return 0.0, empty

    bb_d = bollinger_squeeze_detail(inp.closes)
    obv_d = obv_accumulation_detail(inp.closes, inp.volumes)
    rs_d = xbi_relative_strength_detail(inp.closes, inp.xbi_closes)
    vol_d = volume_ratio_detail(inp.volumes)

    raw = float(bb_d["score"]) + float(obv_d["score"]) + float(rs_d["score"]) + float(vol_d["score"])
    scaled = max(raw, 0.0) / 28.0 * 20.0
    breakdown: dict[str, Any] = {
        "total": round(scaled, 1),
        "raw_total": round(raw, 2),
        "raw_max": 28.0,
        "bollinger_squeeze": bb_d,
        "obv_accumulation": obv_d,
        "xbi_relative_strength": rs_d,
        "volume_ratio": vol_d,
    }
    return raw, breakdown


PHARMA_FOCUS: dict[str, tuple[str, ...]] = {
    "nash": ("AstraZeneca", "Novo Nordisk", "Gilead", "Madrigal"),
    "non-alcoholic steatohepatitis": ("AstraZeneca", "Novo Nordisk", "Gilead", "Madrigal"),
    "oncology": ("Pfizer", "BMS", "Roche", "AstraZeneca", "Merck"),
    "cancer": ("Pfizer", "BMS", "Roche", "AstraZeneca", "Merck"),
    "rheumatoid arthritis": ("AbbVie", "Pfizer", "Eli Lilly", "UCB"),
    "neurology": ("Biogen", "Roche", "Novartis", "Sanofi"),
    "rare disease": ("Sanofi", "Alexion", "BioMarin", "Ultragenyx"),
    "cardiovascular": ("Novartis", "AstraZeneca", "Amgen", "Pfizer"),
    "immunology": ("AbbVie", "Janssen", "UCB", "Sanofi"),
}


def _tam_bn_lookup(condition: str | None) -> float:
    key = normalize_indication(condition)
    if key:
        for k, v in MARKET_SIZE_ESTIMATES.items():
            if k in key:
                return float(v)
    return 1.5


def _pharma_acquirers(condition: str | None) -> list[str]:
    key = normalize_indication(condition)
    if not key:
        return []
    for k, names in PHARMA_FOCUS.items():
        if k in key:
            return list(names)
    return []


def _phase_num_from_text(phase: str | None) -> int | None:
    if not phase or not str(phase).strip():
        return None
    p = _normalize_phase_text(str(phase))
    if "phase 3" in p or "phase3" in p.replace(" ", ""):
        return 3
    if "phase 2" in p:
        return 2
    if "phase 1" in p:
        return 1
    m = re.search(r"phase\s*(\d)", p)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


def _is_phase3(phase: str | None) -> bool:
    if not phase:
        return False
    p = _normalize_phase_text(str(phase))
    return "phase 3" in p or "pivotal" in p


def cash_runway_detail(
    runway_months: float | None,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Cash runway score (−8 to 8) with veto / warning flags."""
    m = meta or {}
    status_raw = m.get("runway_status") or m.get("status")

    if runway_months is None or status_raw == "cash_data_unavailable":
        return {
            "score": 3.0,
            "max": 8,
            "runway_months": None,
            "total_cash_mm": None,
            "monthly_burn_mm": None,
            "veto_triggered": False,
            "warning": False,
            "status": "cash_data_unavailable",
            "flag": "cash_data_unavailable",
        }

    rm = float(runway_months)
    total_cash = m.get("total_cash")
    burn_m = m.get("net_burn_monthly")
    total_cash_mm = round(float(total_cash) / 1e6, 1) if total_cash is not None else None
    if rm >= 999 or (burn_m is not None and float(burn_m) <= 0):
        burn_mm = 0.0
    else:
        burn_mm = round(abs(float(burn_m)) / 1e6, 1) if burn_m is not None else None

    if rm >= 999:
        score = 8.0
    elif rm >= 24:
        score = 8.0
    elif rm >= 18:
        score = 7.0
    elif rm >= 12:
        score = 5.0
    elif rm >= 9:
        score = 3.0
    elif rm >= 6:
        score = 1.0
    elif rm >= 3:
        score = -3.0
    else:
        score = -8.0

    if rm >= 12:
        st = "safe"
    elif rm >= 6:
        st = "caution"
    else:
        st = "danger"

    return {
        "score": score,
        "max": 8,
        "runway_months": round(rm, 1) if rm < 999 else 999.0,
        "total_cash_mm": total_cash_mm,
        "monthly_burn_mm": burn_mm,
        "veto_triggered": rm < 3,
        "warning": rm < 6,
        "status": st,
    }


def cash_runway_component_score(months: float | None) -> float:
    d = cash_runway_detail(months)
    return float(d["score"])


def mc_pipeline_ratio_detail(
    market_cap: float | None,
    condition: str | None,
    *,
    phase_probability: float | None = None,
    tam_billions: float | None = None,
    market_share: float = 0.08,
    revenue_multiple: float = 5.0,
) -> dict[str, Any]:
    """Market cap vs probability-weighted pipeline NPV (score 0–8)."""
    if not market_cap or market_cap <= 0:
        return {
            "score": 0.0,
            "max": 8,
            "ratio": None,
            "market_cap_bn": None,
            "pipeline_npv_estimate_bn": None,
            "prob_approval_used": phase_probability,
            "tam_estimate_bn": tam_billions,
            "peak_sales_bn": None,
            "interpretation": "unknown",
            "status": "missing_market_cap",
        }

    tam_bn = float(tam_billions) if tam_billions is not None else _tam_bn_lookup(condition)
    prob = float(phase_probability) if phase_probability is not None else 0.15
    peak_sales_bn = tam_bn * market_share
    pipeline_npv_bn = peak_sales_bn * prob * revenue_multiple
    market_cap_bn = float(market_cap) / 1e9
    ratio = market_cap_bn / pipeline_npv_bn if pipeline_npv_bn > 0 else 999.0

    if ratio < 0.2:
        score = 8.0
    elif ratio < 0.4:
        score = 6.0
    elif ratio < 0.7:
        score = 4.0
    elif ratio < 1.0:
        score = 2.0
    elif ratio < 1.5:
        score = 1.0
    else:
        score = 0.0

    if ratio < 0.5:
        interpretation = "undervalued"
    elif ratio < 1.2:
        interpretation = "fairly valued"
    else:
        interpretation = "overvalued"

    return {
        "score": score,
        "max": 8,
        "ratio": round(ratio, 2),
        "market_cap_bn": round(market_cap_bn, 2),
        "pipeline_npv_estimate_bn": round(pipeline_npv_bn, 2),
        "prob_approval_used": round(prob, 3),
        "tam_estimate_bn": round(tam_bn, 2),
        "peak_sales_bn": round(peak_sales_bn, 2),
        "market_share_assumption": market_share,
        "revenue_multiple": revenue_multiple,
        "interpretation": interpretation,
        "status": "ok",
    }


def mc_pipeline_ratio_score(market_cap: float | None, pipeline_value: float | None) -> float:
    """Legacy wrapper — prefer ``mc_pipeline_ratio_detail``."""
    if pipeline_value and pipeline_value > 0 and market_cap:
        ratio = market_cap / pipeline_value
        d = mc_pipeline_ratio_detail(market_cap, None, tam_billions=1.5)
        # approximate from ratio directly
        if ratio < 0.2:
            return 8.0
        if ratio < 0.4:
            return 6.0
        if ratio < 0.7:
            return 4.0
        if ratio < 1.0:
            return 2.0
        if ratio < 1.5:
            return 1.0
        return 0.0
    return float(mc_pipeline_ratio_detail(market_cap, None)["score"])


def ma_attractiveness_detail(
    *,
    first_in_class: bool | None,
    condition: str | None,
    phase: str | None,
    market_cap: float | None,
    momentum_positive: bool,
    tam_billions: float | None = None,
) -> dict[str, Any]:
    """Rule-based M&A attractiveness (0–7)."""
    tam_bn = float(tam_billions) if tam_billions is not None else _tam_bn_lookup(condition)
    mcap = float(market_cap) if market_cap else None
    mcap_bn = round(mcap / 1e9, 2) if mcap else None
    acquirers = _pharma_acquirers(condition)
    rules: list[str] = []
    score = 0.0

    if first_in_class is True and tam_bn > 3.0:
        score += 3.0
        rules.append("first_in_class_large_market")
    if _is_phase3(phase) and momentum_positive:
        score += 2.0
        rules.append("phase3_momentum")
    if mcap is not None and mcap < 2_000_000_000:
        score += 1.0
        rules.append("acquirable_size")
    if acquirers:
        score += 1.0
        rules.append("pharma_focus_area")

    score = min(score, 7.0)
    return {
        "score": score,
        "max": 7,
        "rules_fired": rules,
        "potential_acquirers": acquirers,
        "market_cap_bn": mcap_bn,
        "acquirable": bool(mcap is not None and mcap < 2_000_000_000),
        "status": "ok",
    }


def compute_cluster_d(inp: SdsTickerInput) -> tuple[float, dict[str, Any]]:
    """Cluster D — fundamentals (cash runway, MC/pipeline, M&A)."""
    meta = inp.cluster_d_meta or {}
    slope20 = linear_regression_slope_pct(inp.closes, 20) or 0.0
    mom_pos = slope20 > 0

    runway_m = inp.cash_runway_months
    if runway_m is None:
        runway_m = meta.get("runway_months")

    cash_d = cash_runway_detail(runway_m, meta=meta)

    tam_bn = meta.get("tam_estimate_bn")
    if tam_bn is None and inp.condition:
        tam_bn = _tam_bn_lookup(inp.condition)

    prob = inp.phase_probability
    if prob is None:
        ph_num = _phase_num_from_text(inp.phase)
        if ph_num is not None:
            from prediction.phase_pos import get_phase_pos

            prob = get_phase_pos(ph_num)

    mc_d = mc_pipeline_ratio_detail(
        inp.market_cap,
        inp.condition or inp.indication,
        phase_probability=prob,
        tam_billions=tam_bn,
    )

    ma_d = ma_attractiveness_detail(
        first_in_class=inp.first_in_class,
        condition=inp.condition or inp.indication,
        phase=inp.phase,
        market_cap=inp.market_cap,
        momentum_positive=mom_pos,
        tam_billions=tam_bn,
    )

    raw = float(cash_d["score"]) + float(mc_d["score"]) + float(ma_d["score"])
    scaled = max(raw, 0.0) / 23.0 * 15.0
    if cash_d.get("veto_triggered"):
        scaled = 0.0

    breakdown: dict[str, Any] = {
        "total": round(scaled, 1),
        "raw_total": round(raw, 2),
        "raw_max": 23.0,
        "cash_veto": bool(cash_d.get("veto_triggered")),
        "cash_runway": cash_d,
        "mc_pipeline_ratio": mc_d,
        "ma_attractiveness": ma_d,
        "slope20": round(slope20, 4),
        "momentum_positive": mom_pos,
        "phase_probability": prob,
    }
    return raw, breakdown


def _cluster_d_missing_from_breakdown(breakdown: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    cash = breakdown.get("cash_runway") or {}
    if cash.get("status") == "cash_data_unavailable" or cash.get("flag") == "cash_data_unavailable":
        out["cash_runway"] = "cash_data_unavailable"
    mc = breakdown.get("mc_pipeline_ratio") or {}
    if mc.get("status") == "missing_market_cap":
        out["mc_pipeline_ratio"] = "missing_market_cap"
    return out


def short_interest_detail(
    short_pct: float | None,
    *,
    days_to_cover: float | None,
    momentum_positive: bool,
) -> dict[str, Any]:
    """Cluster B short interest score (−5 to 10) with squeeze / bearish flags."""
    if short_pct is None:
        return {
            "score": None,
            "max": 10,
            "short_pct": None,
            "days_to_cover": days_to_cover,
            "squeeze_setup": False,
            "structural_bearish": False,
            "status": "unavailable",
        }

    pct = float(short_pct)
    dtc = float(days_to_cover) if days_to_cover is not None else None
    squeeze = pct > 20 and momentum_positive and (dtc is None or dtc > 5)
    bearish = pct > 20 and not momentum_positive

    if squeeze:
        score = 10.0
    elif pct > 20 and momentum_positive:
        score = 7.0
    elif bearish:
        score = -5.0
    elif pct > 15:
        score = 5.0
    elif pct > 10:
        score = 3.0
    elif pct > 5:
        score = 1.0
    else:
        score = 0.0

    return {
        "score": score,
        "max": 10,
        "short_pct": round(pct, 2),
        "days_to_cover": round(dtc, 2) if dtc is not None else None,
        "squeeze_setup": squeeze,
        "structural_bearish": bearish,
        "status": "ok",
    }


def short_interest_component_score(
    short_pct: float | None,
    *,
    momentum_positive: bool,
    days_to_cover: float | None = None,
) -> float | None:
    detail = short_interest_detail(short_pct, days_to_cover=days_to_cover, momentum_positive=momentum_positive)
    sc = detail.get("score")
    return float(sc) if sc is not None else None


def institutional_delta_detail(
    delta_pct: float | None,
    *,
    premium_fund_present: bool = False,
    premium_funds: Sequence[str] | None = None,
    staleness_days: int | None = None,
    latest_quarter: str | None = None,
    status: str = "ok",
) -> dict[str, Any]:
    if delta_pct is None or status == "no_institutional_data":
        return {
            "score": None,
            "max": 8,
            "delta_pct": None,
            "premium_fund_present": False,
            "premium_funds": [],
            "staleness_days": staleness_days,
            "latest_quarter": latest_quarter,
            "data_age_warning": bool(staleness_days and staleness_days > 75),
            "status": status,
        }

    d = float(delta_pct)
    if premium_fund_present and d > 5:
        score = 8.0
    elif premium_fund_present:
        score = 6.0
    elif d > 15:
        score = 7.0
    elif d > 8:
        score = 5.0
    elif d > 3:
        score = 3.0
    elif d >= 0:
        score = 1.0
    elif d > -5:
        score = 0.0
    else:
        score = -2.0

    return {
        "score": score,
        "max": 8,
        "delta_pct": round(d, 2),
        "premium_fund_present": premium_fund_present,
        "premium_funds": list(premium_funds or []),
        "staleness_days": staleness_days,
        "latest_quarter": latest_quarter,
        "data_age_warning": bool(staleness_days and staleness_days > 75),
        "status": "ok",
    }


def analyst_upgrade_detail(
    analyst_score: float | None,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    m = meta or {}
    sc = analyst_score
    analyst_status = m.get("analyst_status") or m.get("status")
    if sc is None and analyst_status in ("unavailable", "api_failed"):
        return {
            "score": None,
            "max": 8,
            "upgrades_60d": 0,
            "downgrades_60d": 0,
            "tier1_coverage": False,
            "latest": None,
            "all_grades_60d": [],
            "status": "unavailable",
        }
    upgrades = m.get("upgrades_count", m.get("analyst_events_n", 0)) or 0
    if analyst_status == "no_recent_coverage" or (
        (sc or 0) == 0 and upgrades == 0 and not m.get("latest_action")
    ):
        ui_status = "no_recent_coverage"
    else:
        ui_status = "ok"
    return {
        "score": float(sc) if sc is not None else 0.0,
        "max": 8,
        "upgrades_60d": upgrades,
        "downgrades_60d": m.get("downgrades_count", 0),
        "tier1_coverage": bool(m.get("tier1_coverage")),
        "latest": m.get("latest_action"),
        "all_grades_60d": m.get("all_grades_60d") or m.get("analyst_events_60d") or [],
        "status": ui_status,
    }


def compute_cluster_b(inp: SdsTickerInput) -> tuple[float, dict[str, Any]]:
    """Cluster B raw sum with proportional weight when components unavailable."""
    meta = inp.cluster_b_meta or {}
    slope20 = linear_regression_slope_pct(inp.closes, 20) or 0.0
    mom_pos = slope20 > 0

    short_d = short_interest_detail(
        inp.short_interest_pct,
        days_to_cover=inp.days_to_cover,
        momentum_positive=mom_pos,
    )
    if meta.get("short_status"):
        short_d["status"] = meta["short_status"]

    inst_d = institutional_delta_detail(
        inp.institutional_delta_pct if inp.institutional_delta_pct is not None else meta.get("inst_delta_pct"),
        premium_fund_present=bool(meta.get("premium_fund_present")),
        premium_funds=meta.get("premium_funds_list") or meta.get("premium_funds"),
        staleness_days=meta.get("staleness_days"),
        latest_quarter=meta.get("latest_quarter"),
        status=str(meta.get("inst_status") or "ok"),
    )

    analyst_d = analyst_upgrade_detail(
        inp.analyst_upgrade_score,
        meta=meta,
    )

    weights = {"short_interest": 10.0, "analyst_upgrades": 8.0, "institutional_delta": 8.0}
    parts: dict[str, float] = {}
    if short_d.get("score") is not None:
        parts["short_interest"] = float(short_d["score"])
    if analyst_d.get("score") is not None:
        parts["analyst_upgrades"] = float(analyst_d["score"])
    if inst_d.get("score") is not None:
        parts["institutional_delta"] = float(inst_d["score"])

    raw = sum(parts.values())
    weight_sum = sum(weights[k] for k in parts)
    cluster_scaled = max(raw, 0.0) / weight_sum * 25.0 if weight_sum > 0 else 0.0

    breakdown = {
        "total": round(cluster_scaled, 1),
        "raw_total": round(raw, 2),
        "raw_max": 26.0,
        "weight_used": round(weight_sum, 1),
        "slope20": round(slope20, 4),
        "momentum_positive": mom_pos,
        "short_interest": short_d,
        "analyst_upgrades": analyst_d,
        "institutional_delta": inst_d,
    }
    return raw, breakdown


def catalyst_window_detail(days_to_cd: int | None, *, cd_date: str | None = None) -> dict[str, Any]:
    """Optimal entry timing vs Completion Date (score 0–6)."""
    base: dict[str, Any] = {
        "score": 0.0,
        "max": 6,
        "days_to_cd": days_to_cd,
        "cd_date": cd_date,
        "flag": "NO_CD",
        "label": "No CD scheduled",
        "status": "no_cd",
    }
    if days_to_cd is None:
        return base

    d = int(days_to_cd)
    if d < 0:
        days_since = abs(d)
        if days_since <= 7:
            return {
                **base,
                "score": 0.0,
                "flag": "POST_EVENT",
                "label": "Post-event — monitor for dislocation",
                "status": "post_event",
            }
        return {
            **base,
            "score": 0.0,
            "flag": "CD_PASSED",
            "label": "CD passed",
            "status": "cd_passed",
        }

    if d <= 7:
        score, flag, label = 2.0, "BINARY_EVENT_LOCK", "Binary event — hold only"
    elif d <= 14:
        score, flag, label = 4.0, "LATE_ENTRY", "Late entry window"
    elif d <= 30:
        score, flag, label = 6.0, "OPTIMAL", "Optimal entry window"
    elif d <= 45:
        score, flag, label = 5.0, "GOOD", "Good entry window"
    elif d <= 60:
        score, flag, label = 3.0, "EARLY", "Early accumulation zone"
    elif d <= 90:
        # Align with Simulation CD watch (61–90 d): monitor, not penalise like T>90.
        score, flag, label = 3.0, "EARLY_WATCH", "Early watch — Simulation 4–2 mo window"
    elif d <= 120:
        score, flag, label = 2.5, "MONITOR", "Monitor window — CD 4–2 mo (outer band)"
    else:
        score, flag, label = 0.0, "DISTANT", "Beyond monitor horizon"

    return {
        "score": score,
        "max": 6,
        "days_to_cd": d,
        "cd_date": cd_date,
        "flag": flag,
        "label": label,
        "status": "ok",
    }


def catalyst_window_score(days_to_cd: int | None) -> float:
    return float(catalyst_window_detail(days_to_cd).get("score") or 0.0)


def catalyst_quality_modifier(
    phase_probability: float | None,
    pred5_live: float | None,
) -> float:
    prob = float(phase_probability) if phase_probability is not None else None
    pred = float(pred5_live) if pred5_live is not None else None
    if prob is not None and prob > 0.5 and pred is not None and pred > 5.0:
        return 0.5
    if prob is not None and prob > 0.35:
        return 0.2
    if prob is not None and prob < 0.15:
        return -0.3
    return 0.0


def sequential_catalyst_detail(
    catalyst_types: Sequence[str],
    *,
    events_detected: int = 0,
    days_to_cd: int | None = None,
) -> dict[str, Any]:
    """Distinct catalyst types in 90d window (score 0–4)."""
    types = sorted(set(str(t) for t in catalyst_types if t))
    n_types = len(types)

    if n_types >= 4:
        score = 4.0
    elif n_types == 3:
        score = 3.0
    elif n_types == 2:
        score = 2.0
    elif n_types == 1:
        score = 1.0
    else:
        score = 0.0

    label = f"{n_types} catalyst type{'s' if n_types != 1 else ''} in 90d window"
    return {
        "score": score,
        "max": 4,
        "catalyst_count": n_types,
        "catalyst_types": types,
        "events_detected": events_detected,
        "label": label,
        "status": "ok",
    }


def sequential_catalyst_score(catalyst_types: Sequence[str]) -> float:
    return float(sequential_catalyst_detail(catalyst_types).get("score") or 0.0)


def compute_cluster_e(inp: SdsTickerInput) -> tuple[float, dict[str, Any]]:
    """Cluster E — catalyst timing window + sequential catalyst stack."""
    meta = inp.cluster_e_meta or {}
    cd_date = inp.cd_date or meta.get("cd_date")

    win = catalyst_window_detail(inp.days_to_cd, cd_date=cd_date)
    modifier = catalyst_quality_modifier(inp.phase_probability, inp.pred5_live)
    base_score = float(win.get("score") or 0.0)
    adjusted = min(max(base_score * (1.0 + modifier), 0.0), 6.0)
    win = {
        **win,
        "score_base": round(base_score, 2),
        "quality_modifier": round(modifier, 2),
        "score": round(adjusted, 2),
    }

    types = list(inp.catalyst_types_90d or meta.get("catalyst_types") or [])
    events_n = meta.get("events_detected")
    if events_n is None:
        events_n = len(inp.catalyst_events_90d or meta.get("catalyst_events_90d") or [])
    seq = sequential_catalyst_detail(
        types,
        events_detected=int(events_n or 0),
        days_to_cd=inp.days_to_cd,
    )

    d = int(inp.days_to_cd) if inp.days_to_cd is not None else None
    flags = {
        "binary_event_lock": d is not None and 0 <= d <= 7,
        "optimal_window": d is not None and 14 < d <= 30,
        "late_entry": d is not None and 7 < d <= 14,
        "post_event": d is not None and d < 0,
    }

    raw = float(win["score"]) + float(seq["score"])
    total = round(raw, 1)

    breakdown: dict[str, Any] = {
        "total": total,
        "raw_total": round(raw, 2),
        "raw_max": 10.0,
        "catalyst_window": win,
        "sequential_catalysts": seq,
        "flags": flags,
    }
    return raw, breakdown


def classify_zone(sds: float) -> tuple[ZoneLabel, str, str]:
    if sds >= 75:
        return "SUPERNOVA ZONE", "#16a34a", "Full position"
    if sds >= 55:
        return "CANDIDATE", "#4ade80", "Small position, monitor daily"
    if sds >= 30:
        return "WATCH", "#facc15", "Track weekly"
    return "DISTANT", "#dc2626", "No action"


def _coverage(inp: SdsTickerInput, raw: dict[str, float | None]) -> tuple[float, dict[str, bool]]:
    flags = {
        "price": len(inp.closes) >= 126,
        "volume": len(inp.volumes) >= 25,
        "xbi": len(inp.xbi_closes) >= 90,
        "days_to_cd": inp.days_to_cd is not None,
        "phase": bool(inp.phase),
        "cash_runway": inp.cash_runway_months is not None or bool((inp.cluster_d_meta or {}).get("runway_months")),
        "short_interest": inp.short_interest_pct is not None,
    }
    present = sum(1 for v in flags.values() if v)
    missing_pct = round(100.0 * (1.0 - present / max(len(flags), 1)), 1)
    return missing_pct, flags


def compute_sds(inp: SdsTickerInput) -> SdsResult:
    """Assemble SDS from component raw scores (brief Part 4)."""
    c_raw, cluster_c_breakdown = compute_cluster_c(inp)
    bb_d = cluster_c_breakdown["bollinger_squeeze"]
    obv_d = cluster_c_breakdown["obv_accumulation"]
    rs_d = cluster_c_breakdown["xbi_relative_strength"]
    vol_d = cluster_c_breakdown["volume_ratio"]
    bb = float(bb_d["score"])
    obv = float(obv_d["score"])
    rs90 = float(rs_d["score"])
    vol_r = float(vol_d["score"])
    cluster_c_missing = _cluster_c_missing_from_breakdown(cluster_c_breakdown)

    a_raw, cluster_a_breakdown = compute_cluster_a(inp)
    phase_cred = float(cluster_a_breakdown["phase_credibility"]["score"])
    endpoint_cred = float(cluster_a_breakdown["endpoint_credibility"]["score"])
    unmet_val = cluster_a_breakdown["unmet_need"].get("score")
    unmet = float(unmet_val) if unmet_val is not None else None
    mkt_sz = float(cluster_a_breakdown["market_size"]["score"])
    cluster_a = float(cluster_a_breakdown["total"])

    b_raw, cluster_b_breakdown = compute_cluster_b(inp)
    short_sc = cluster_b_breakdown["short_interest"].get("score")
    analyst = cluster_b_breakdown["analyst_upgrades"].get("score")
    inst_delta = cluster_b_breakdown["institutional_delta"].get("score")
    cluster_b = float(cluster_b_breakdown["total"])

    d_raw, cluster_d_breakdown = compute_cluster_d(inp)
    cash_d = cluster_d_breakdown["cash_runway"]
    mc_d = cluster_d_breakdown["mc_pipeline_ratio"]
    ma_d = cluster_d_breakdown["ma_attractiveness"]
    cash_rw = float(cash_d["score"])
    mc_pipe = float(mc_d["score"])
    ma_attr = float(ma_d["score"])
    cluster_d = float(cluster_d_breakdown["total"])
    cluster_d_missing = _cluster_d_missing_from_breakdown(cluster_d_breakdown)
    cash_veto = bool(cluster_d_breakdown.get("cash_veto"))

    e_raw, cluster_e_breakdown = compute_cluster_e(inp)
    win_d = cluster_e_breakdown["catalyst_window"]
    seq_d = cluster_e_breakdown["sequential_catalysts"]
    cat_win = float(win_d["score"])
    seq_cat = float(seq_d["score"])
    cluster_e = float(cluster_e_breakdown["total"])

    raw: dict[str, float | None] = {
        "bb_squeeze": bb,
        "obv_accumulation": obv,
        "xbi_rs_90d": rs90,
        "volume_ratio": vol_r,
        "bb_width_percentile": bb_d.get("bb_percentile"),
        "volume_ratio_raw": vol_d.get("ratio_5d_vs_20d"),
        "relative_strength_90d": rs_d.get("rs_90d"),
        "phase_credibility": phase_cred,
        "endpoint_credibility": endpoint_cred,
        "unmet_need": unmet,
        "market_size": mkt_sz,
        "institutional_delta": float(inst_delta) if inst_delta is not None else None,
        "short_interest": float(short_sc) if short_sc is not None else None,
        "analyst_upgrade": float(analyst) if analyst is not None else None,
        "cash_runway": cash_rw,
        "mc_pipeline_ratio": mc_pipe,
        "ma_attractiveness": ma_attr,
        "catalyst_window": cat_win,
        "sequential_catalyst": seq_cat,
    }

    b_raw = (inst_delta or 0.0) + (short_sc or 0.0) + (analyst or 0.0)

    c_raw_sum = bb + obv + rs90 + vol_r
    cluster_c_score = max(c_raw_sum, 0.0) / 28.0 * 20.0
    cluster_c_breakdown["total"] = round(cluster_c_score, 1)

    sds_raw = cluster_a + cluster_b + cluster_c_score + cluster_d + cluster_e
    veto: VetoCode = None
    recommendation: str | None = None

    merged_missing = dict(cluster_c_missing)
    merged_missing.update(cluster_d_missing)

    if cash_veto:
        return SdsResult(
            ticker=inp.ticker,
            sds=0.0,
            zone_label="DISTANT",
            zone_color="#dc2626",
            zone_action="No action",
            veto="CASH_CRISIS",
            recommendation="VETO — cash runway < 3 months",
            cluster_scores={
                "catalyst_quality": round(cluster_a, 1),
                "institutional_signal": round(cluster_b, 1),
                "price_structure": round(cluster_c_score, 1),
                "fundamentals": round(cluster_d, 1),
                "timing": round(cluster_e, 1),
            },
            component_raw=raw,
            missing_data_pct=_coverage(inp, raw)[0],
            coverage_fields=_coverage(inp, raw)[1],
            missing_data=merged_missing,
            cluster_a=cluster_a_breakdown,
            cluster_b=cluster_b_breakdown,
            cluster_c=cluster_c_breakdown,
            cluster_d=cluster_d_breakdown,
            cluster_e=cluster_e_breakdown,
        )

    regime = str(inp.market_regime or "NEUTRAL").upper()
    if regime == "CRISIS":
        return SdsResult(
            ticker=inp.ticker,
            sds=0.0,
            zone_label="DISTANT",
            zone_color="#dc2626",
            zone_action="No action",
            veto="MARKET_CRISIS",
            recommendation="VETO — market regime CRISIS",
            cluster_scores={
                "catalyst_quality": round(cluster_a, 1),
                "institutional_signal": round(cluster_b, 1),
                "price_structure": round(cluster_c_score, 1),
                "fundamentals": round(cluster_d, 1),
                "timing": round(cluster_e, 1),
            },
            component_raw=raw,
            missing_data_pct=_coverage(inp, raw)[0],
            coverage_fields=_coverage(inp, raw)[1],
            missing_data=merged_missing,
            cluster_a=cluster_a_breakdown,
            cluster_b=cluster_b_breakdown,
            cluster_c=cluster_c_breakdown,
            cluster_d=cluster_d_breakdown,
            cluster_e=cluster_e_breakdown,
        )

    e_flags = cluster_e_breakdown.get("flags") or {}
    if e_flags.get("binary_event_lock") or (inp.days_to_cd is not None and inp.days_to_cd <= 7):
        veto = "BINARY_EVENT_LOCK"
        recommendation = "HOLD — too close to binary event (T≤7)"

    sds_final = round(max(0.0, min(100.0, sds_raw)), 1)
    zone_label, zone_color, zone_action = classify_zone(sds_final)
    miss_pct, cov_flags = _coverage(inp, raw)

    return SdsResult(
        ticker=inp.ticker,
        sds=sds_final,
        zone_label=zone_label,
        zone_color=zone_color,
        zone_action=zone_action,
        veto=veto,
        recommendation=recommendation,
        cluster_scores={
            "catalyst_quality": round(cluster_a, 1),
            "institutional_signal": round(cluster_b, 1),
            "price_structure": round(cluster_c_score, 1),
            "fundamentals": round(cluster_d, 1),
            "timing": round(cluster_e, 1),
        },
        component_raw=raw,
        missing_data_pct=miss_pct,
        coverage_fields=cov_flags,
        missing_data=merged_missing,
        cluster_a=cluster_a_breakdown,
        cluster_b=cluster_b_breakdown,
        cluster_c=cluster_c_breakdown,
        cluster_d=cluster_d_breakdown,
        cluster_e=cluster_e_breakdown,
    )
