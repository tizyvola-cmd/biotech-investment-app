"""
Event Impact Score (EIS) — market reaction to corporate/clinical events.

EIS = w1 × ΔP_1d + w2 × ΔP_3d + w3 × Vol_term + w4 × Sent_term

Where:
  ΔP_1d, ΔP_3d — percent change vs baseline close (T → T+1, T → T+3)
  Vol_term     — (vol_ratio - 1) × 20, vol_ratio = volume_T+1 / 30d avg volume
  Sent_term    — sentiment × 10, sentiment ∈ [-2, +2]

Default weights (biotech-tuned, overridable via env EIS_W1..EIS_W4):
  0.35, 0.35, 0.15, 0.15

EIS_intrinsic is a sibling of market ``score``, not part of the weighted sum:
  clamp(kpi_score, -2, +2) × K_INTRINSIC
  K_INTRINSIC default 10 (same multiplier as Sent_term = sentiment × 10).
"""

from __future__ import annotations

import os
import re
from typing import Any


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def default_weights() -> tuple[float, float, float, float]:
    return (
        _float_env("EIS_W1", 0.35),
        _float_env("EIS_W2", 0.35),
        _float_env("EIS_W3", 0.15),
        _float_env("EIS_W4", 0.15),
    )


# Scale kpi_score [-2, +2] onto a term comparable to Sent_term. Not a market weight.
K_INTRINSIC = _float_env("EIS_K_INTRINSIC", 10.0)


def eis_intrinsic_from_kpi(kpi_score: float | None) -> float | None:
    """clamp(kpi_score, -2, +2) × K_INTRINSIC. None when KPI is missing."""
    if kpi_score is None:
        return None
    try:
        k = float(kpi_score)
    except (TypeError, ValueError):
        return None
    if k != k:  # NaN
        return None
    clamped = max(-2.0, min(2.0, k))
    return round(clamped * K_INTRINSIC, 2)


_PENDING_RE = re.compile(
    r"\b(seeking|pending|plans? to (?:file|submit|seek)|will (?:file|submit)|awaiting|"
    r"application (?:for|to) (?:fda|ema)|submitted an? (?:n[db]a|bla))\b",
    re.I,
)
_HOLD_LIFTED_RE = re.compile(
    r"\b(clinical hold (?:lifted|removed|released)|lifted (?:the )?clinical hold)\b",
    re.I,
)
_HOLD_RE = re.compile(r"\bclinical hold\b", re.I)
_CRL_RE = re.compile(
    r"\b(complete response letter|\bcrl\b|(?:fda|ema) (?:complete response|reject(?:ed|s|ion)|refused to file))\b",
    re.I,
)
_DENIED_RE = re.compile(
    r"\b((?:fda|ema) (?:did not|does not|declined to) approv|approval denied|"
    r"not approved by (?:the )?(?:fda|ema))\b",
    re.I,
)
_APPROVAL_RE = re.compile(
    r"\b((?:fda|ema|mhra|pmda)\s+approv(?:ed|es|al)|approval granted|accelerated approval|"
    r"full approval|granted (?:an? )?(?:nda |bla |snda )?approval|"
    r"approved (?:the )?(?:nda|bla|snda|indication|drug))\b",
    re.I,
)
_EARNINGS_RE = re.compile(
    r"\b(earnings|results of operations|financial results|quarterly)\b",
    re.I,
)


def _event_text_blob(ev: dict[str, Any]) -> str:
    parts = [ev.get("event_title"), ev.get("title"), ev.get("summary")]
    return "\n".join(str(p) for p in parts if p)


def _has_real_outcome_kpi(indicators: list[dict[str, Any]]) -> bool:
    for ind in indicators:
        kt = str(ind.get("kpi_type") or "").lower()
        if kt in ("efficacy", "regulatory"):
            return True
        if ind.get("endpoint_met") is not None and kt != "enrollment":
            return True
    return False


def _is_earnings_only(ev: dict[str, Any], blob: str) -> bool:
    items = str(ev.get("items_raw") or ev.get("itemsRaw") or "")
    st = str(ev.get("source_type") or ev.get("event_type") or ev.get("sourceType") or "").lower()
    if not re.search(r"\b2\.02\b", items) and st != "sec_8k":
        return False
    if (
        _HOLD_LIFTED_RE.search(blob)
        or _HOLD_RE.search(blob)
        or _CRL_RE.search(blob)
        or _DENIED_RE.search(blob)
        or _APPROVAL_RE.search(blob)
    ):
        return False
    return bool(_EARNINGS_RE.search(blob) or re.search(r"\b2\.02\b", items))


def virtual_regulatory_indicator(
    ev: dict[str, Any],
    existing: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Synthetic approval / CRL / hold KPI when the event has no quantitative KPIs."""
    base = [i for i in (existing or []) if isinstance(i, dict)]
    if _has_real_outcome_kpi(base):
        return None
    blob = _event_text_blob(ev)
    if not blob.strip() or _PENDING_RE.search(blob):
        return None
    if _is_earnings_only(ev, blob):
        return None

    if _HOLD_LIFTED_RE.search(blob):
        return {
            "label": "Clinical hold lifted",
            "value": "lifted",
            "kpi_type": "regulatory",
            "endpoint_met": True,
            "direction": "up",
            "source": "virtual",
        }
    if _HOLD_RE.search(blob):
        return {
            "label": "Clinical hold",
            "value": "issued",
            "kpi_type": "regulatory",
            "endpoint_met": False,
            "direction": "down",
            "source": "virtual",
        }
    if _CRL_RE.search(blob):
        return {
            "label": "Complete response letter",
            "value": "issued",
            "kpi_type": "regulatory",
            "endpoint_met": False,
            "direction": "down",
            "source": "virtual",
        }
    if _DENIED_RE.search(blob):
        return {
            "label": "Approval denied",
            "value": "denied",
            "kpi_type": "regulatory",
            "endpoint_met": False,
            "direction": "down",
            "source": "virtual",
        }
    if _APPROVAL_RE.search(blob):
        return {
            "label": "Regulatory approval",
            "value": "granted",
            "kpi_type": "regulatory",
            "endpoint_met": True,
            "direction": "up",
            "source": "virtual",
        }
    return None


_RATE_LABEL_RE = re.compile(
    r"\b(orr|dcr|cbr|crr|easi|iga|pasi|response\s*rate|overall\s*response)\b", re.I
)


def _parse_comparative_delta(ind: dict[str, Any]) -> float | None:
    """Treatment vs control delta in percentage points (e.g. 51% vs 15% → +36)."""
    delta = ind.get("effect_size_delta_pp")
    if delta is not None:
        try:
            return float(delta)
        except (TypeError, ValueError):
            pass
    nv = ind.get("numeric_value")
    comp = ind.get("comparator_value_numeric")
    if nv is not None and comp is not None:
        try:
            return float(nv) - float(comp)
        except (TypeError, ValueError):
            pass
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*%\s*(?:vs\.?|versus)\s*~?\s*(\d+(?:\.\d+)?)\s*%",
        str(ind.get("value") or ""),
        re.I,
    )
    if m:
        try:
            return float(m.group(1)) - float(m.group(2))
        except ValueError:
            return None
    return None


def _parse_rate_pct(ind: dict[str, Any]) -> float | None:
    """Extract 0–100 rate from numeric_value or value string (e.g. DCR 78%)."""
    nv = ind.get("numeric_value")
    if nv is not None:
        try:
            v = float(nv)
            if 0 <= v <= 100:
                return v
        except (TypeError, ValueError):
            pass
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", str(ind.get("value") or ""))
    if m:
        try:
            v = float(m.group(1))
            if 0 <= v <= 100:
                return v
        except ValueError:
            return None
    return None


def _efficacy_rate_bonus(ind: dict[str, Any]) -> float:
    """Bonus for strong ORR/DCR/EASI/IGA-style rates when endpoint_met is not set."""
    label = str(ind.get("label") or "")
    kpi_type = str(ind.get("kpi_type") or "").lower()
    if kpi_type != "efficacy" and not _RATE_LABEL_RE.search(label):
        return 0.0
    direction = str(ind.get("direction") or "unknown").lower()
    sign = -1.0 if direction == "down" else 1.0

    delta = _parse_comparative_delta(ind)
    if delta is not None:
        if delta >= 30:
            return sign * 0.65
        if delta >= 15:
            return sign * 0.40
        if delta >= 5:
            return sign * 0.20
        if delta <= -15:
            return sign * -0.40
        if delta <= -5:
            return sign * -0.20

    rate = _parse_rate_pct(ind)
    if rate is None:
        return 0.0
    direction = str(ind.get("direction") or "unknown").lower()
    sign = -1.0 if direction == "down" else 1.0
    if rate >= 75:
        return sign * 0.65
    if rate >= 55:
        return sign * 0.40
    if rate >= 35:
        return sign * 0.20
    if rate < 15:
        return sign * -0.20
    return 0.0


def _effective_delta_p_3d(delta_p_1d: float, delta_p_3d: float) -> float:
    """Partial credit when T+1 moved but T+3 faded back near baseline."""
    if abs(delta_p_3d) >= 1.0:
        return delta_p_3d
    if delta_p_1d > 1.0 and abs(delta_p_3d) < 1.0:
        return round(delta_p_1d * 0.40, 2)
    if delta_p_1d < -1.0 and abs(delta_p_3d) < 1.0:
        return round(delta_p_1d * 0.40, 2)
    return delta_p_3d


def _vol_reaction_weight(delta_p_1d: float, delta_p_3d_eff: float) -> float:
    """Scale volume term by price reaction — avoid punishing illiquid names on quiet days."""
    reaction = max(abs(delta_p_1d), abs(delta_p_3d_eff))
    if reaction < 0.5:
        return 0.0
    return min(1.0, reaction / 3.0)


def compute_eis(
    *,
    delta_p_1d: float | None,
    delta_p_3d: float | None,
    vol_ratio: float | None = None,
    sentiment: float | None = None,
    kpi_score: float | None = None,
    weights: tuple[float, float, float, float] | None = None,
) -> dict[str, Any]:
    """Compute Event Impact Score.

    kpi_score [-2, +2]: when provided (clinical events), replaces sentiment for
    the w4 term so the formula uses objective KPI quality instead of heuristic text.
    ``eis_intrinsic`` is computed from the same kpi_score but is NOT added into
    ``score`` (clamp × K_INTRINSIC).
    """
    w1, w2, w3, w4 = weights or default_weights()
    d1 = float(delta_p_1d) if delta_p_1d is not None else 0.0
    d3_raw = float(delta_p_3d) if delta_p_3d is not None else 0.0
    d3 = _effective_delta_p_3d(d1, d3_raw)
    vr_raw = float(vol_ratio) if vol_ratio is not None and vol_ratio > 0 else 1.0
    vr = min(vr_raw, 10.0)  # cap micro-cap volume spikes from bad prints
    sent = max(-2.0, min(2.0, float(sentiment if sentiment is not None else 0.0)))

    effective_sentiment = (
        max(-2.0, min(2.0, float(kpi_score))) if kpi_score is not None else sent
    )

    vol_w = _vol_reaction_weight(d1, d3)
    vol_term = (vr - 1.0) * 20.0 * vol_w
    sent_term = effective_sentiment * 10.0
    score = w1 * d1 + w2 * d3 + w3 * vol_term + w4 * sent_term

    return {
        "score": round(score, 2),
        "delta_p_1d": round(d1, 2) if delta_p_1d is not None else None,
        "delta_p_3d": round(d3_raw, 2) if delta_p_3d is not None else None,
        "delta_p_3d_effective": round(d3, 2) if d3 != d3_raw else None,
        "vol_ratio": round(vr_raw, 3),
        "vol_ratio_capped": round(vr, 3),
        "vol_term": round(vol_term, 2),
        "vol_reaction_weight": round(vol_w, 3),
        "sentiment": round(sent, 2),
        "kpi_score": round(kpi_score, 3) if kpi_score is not None else None,
        "eis_intrinsic": eis_intrinsic_from_kpi(kpi_score),
        "sent_term": round(sent_term, 2),
        "weights": {"w1": w1, "w2": w2, "w3": w3, "w4": w4},
    }


def _parse_pvalue(text: str) -> float | None:
    """Extract numeric p-value from strings like '0.003', 'p=0.003', 'p<0.001'."""
    if not text:
        return None
    m = re.search(r"\d+\.\d+", text)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None


_KPI_TYPE_WEIGHT: dict[str, float] = {
    "efficacy": 1.0,
    "regulatory": 0.9,
    "biomarker": 0.6,
    "safety": 0.5,
    "enrollment": 0.2,
    "other": 0.3,
}

_DATA_MATURITY_BONUS: dict[str, float] = {
    "final": 0.30,
    "primary": 0.15,
    "interim": 0.00,
    "not_reported": -0.05,
}


def kpi_intrinsic_score(indicators: list[dict[str, Any]]) -> float:
    """Clinical quality score [-2, +2] from clinical indicator dicts.

    Weighs: endpoint success/failure, p-value, data maturity, KPI type,
    CI availability, SOC comparison.
    """
    if not indicators:
        return 0.0

    best = -2.0
    total = 0.0
    count = 0

    for ind in indicators[:8]:
        s = 0.0
        ep = ind.get("endpoint_met")
        if ep is True:
            s += 0.8
        elif ep is False:
            s -= 0.8
        else:
            direction = str(ind.get("direction") or "unknown").lower()
            if direction == "up":
                s += 0.15
            elif direction == "down":
                s -= 0.15

        p = _parse_pvalue(str(ind.get("p_value") or ""))
        if p is not None:
            if p < 0.001:
                s += 0.60
            elif p < 0.01:
                s += 0.40
            elif p < 0.05:
                s += 0.20
            else:
                s -= 0.10

        dm = str(ind.get("data_maturity") or "not_reported").lower()
        s += _DATA_MATURITY_BONUS.get(dm, 0.0)

        vs_soc = str(ind.get("vs_soc") or "")
        if vs_soc and vs_soc.lower() not in ("null", "n/d", ""):
            s += 0.15

        ci = str(ind.get("confidence_interval") or "")
        if ci and ci.lower() not in ("null", "n/d", ""):
            s += 0.10

        kpi_type = str(ind.get("kpi_type") or "other").lower()
        type_w = _KPI_TYPE_WEIGHT.get(kpi_type, 0.3)
        s *= type_w
        s += _efficacy_rate_bonus(ind)

        total += s
        count += 1
        if s > best:
            best = s

    if count == 0:
        return 0.0

    avg = total / count
    blended = 0.6 * best + 0.4 * avg
    return max(-2.0, min(2.0, round(blended, 3)))


def heuristic_sentiment(items_raw: str, delta_p_1d: float | None) -> float:
    """Rough qualitative score from 8-K item codes and same-day price move."""
    nums = set(items_raw.replace(" ", "").split(","))
    d1 = float(delta_p_1d) if delta_p_1d is not None else 0.0

    if "2.02" in nums or "2.02" in items_raw:
        if d1 >= 8:
            return 2.0
        if d1 >= 3:
            return 1.0
        if d1 <= -8:
            return -2.0
        if d1 <= -3:
            return -1.0
        return 0.0
    if "5.02" in nums:
        return -1.0 if d1 < -2 else 0.0
    if "7.01" in nums or "8.01" in nums:
        if d1 >= 15:
            return 2.0
        if d1 >= 5:
            return 1.0
        if d1 <= -10:
            return -2.0
        if d1 <= -3:
            return -1.0
        return 0.0
    if "1.01" in nums or "3.02" in nums:
        if d1 >= 20:
            return 2.0
        if d1 >= 5:
            return 1.0
        if d1 <= -5:
            return -1.0
        return 0.0
    if d1 >= 10:
        return 1.0
    if d1 <= -10:
        return -1.0
    return 0.0
