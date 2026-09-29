"""
Rescue Cause Attribution — Volume Anomaly + External Alignment indices.

These diagnostic indices help discriminate whether a price decline has an
internal (company-specific) or external (sector/macro) cause:

- **Volume Anomaly Score** (0–100): high → abnormal volume → likely internal event
- **External Alignment Score** (0–100): high → ticker moves with sector → likely external cause

Both are exposed as diagnostic flags alongside the existing rescue score,
WITHOUT modifying the rescue formula (Phase 3 will apply them as adjustment
factors only after validation).
"""
from __future__ import annotations

import math
from typing import Any, Sequence


# ──────────────────────────────────────────────────────────────────────────────
# 1.1 — Volume Anomaly Score
# ──────────────────────────────────────────────────────────────────────────────

# TODO: calibrare su dati reali, valore provvisorio
_VOL_ZSCORE_SCALE = 20.0


def compute_volume_anomaly(
    volumes: Sequence[float],
    *,
    lookback: int = 20,
) -> dict[str, Any]:
    """
    Compute a volume anomaly score based on today's volume vs the trailing
    20-day mean/std.

    Returns a dict with:
      - score: 0–100 (high = anomalous volume, likely internal cause)
      - volume_zscore: raw z-score
      - avg_volume_20d: trailing 20d mean
      - std_volume_20d: trailing 20d std
      - volume_today: today's volume
      - status: "ok" | "insufficient_history"
    """
    base: dict[str, Any] = {
        "score": None,
        "volume_zscore": None,
        "avg_volume_20d": None,
        "std_volume_20d": None,
        "volume_today": None,
        "status": "insufficient_history",
    }

    if not volumes or len(volumes) < lookback + 1:
        return base

    # Exclude today (last element) from the trailing window
    trailing = [float(v) for v in volumes[-(lookback + 1):-1]]
    today_vol = float(volumes[-1])

    if len(trailing) < lookback:
        return base

    mean_20 = sum(trailing) / len(trailing)
    if mean_20 <= 0:
        return base

    variance = sum((v - mean_20) ** 2 for v in trailing) / len(trailing)
    std_20 = math.sqrt(variance)

    if std_20 <= 0:
        # Constant volume — use ratio-based pseudo z-score
        # A 5x spike on flat volume is clearly anomalous
        zscore = (today_vol - mean_20) / mean_20 * 3.0 if today_vol > mean_20 else 0.0
    else:
        zscore = (today_vol - mean_20) / std_20

    # Normalize to 0–100: high z-score → high anomaly
    # TODO: calibrare costante _VOL_ZSCORE_SCALE su dati reali, valore provvisorio
    score = max(0.0, min(100.0, zscore * _VOL_ZSCORE_SCALE))

    return {
        "score": round(score, 1),
        "volume_zscore": round(zscore, 3),
        "avg_volume_20d": round(mean_20, 0),
        "std_volume_20d": round(std_20, 0),
        "volume_today": round(today_vol, 0),
        "status": "ok",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 1.2 — External Alignment Score (simple version: return gap vs XBI)
# ──────────────────────────────────────────────────────────────────────────────

# TODO: calibrare su dati reali, valore provvisorio
_ALIGNMENT_K = 4.0  # scale factor: |Δticker - Δxbi| * k → 0-100 deviation


def compute_external_alignment(
    closes: Sequence[float],
    xbi_closes: Sequence[float],
    *,
    window: int = 5,
) -> dict[str, Any]:
    """
    Compute how aligned the ticker's recent return is with XBI (sector ETF).

    Returns a dict with:
      - score: 0–100 (high = moves with sector = likely external cause)
      - ticker_return_pct: ticker return over window
      - xbi_return_pct: XBI return over window
      - return_gap_pct: |ticker - xbi| return difference
      - status: "ok" | "insufficient_history"

    Logic: if the ticker moves in line with XBI, the decline is likely external.
    score = 100 - clamp(|ticker_ret - xbi_ret| * k, 0, 100)
    """
    base: dict[str, Any] = {
        "score": None,
        "ticker_return_pct": None,
        "xbi_return_pct": None,
        "return_gap_pct": None,
        "status": "insufficient_history",
    }

    if not closes or not xbi_closes:
        return base
    if len(closes) < window + 1 or len(xbi_closes) < window + 1:
        return base

    ticker_old = float(closes[-(window + 1)])
    ticker_new = float(closes[-1])
    xbi_old = float(xbi_closes[-(window + 1)])
    xbi_new = float(xbi_closes[-1])

    if ticker_old <= 0 or xbi_old <= 0:
        return base

    ticker_ret = (ticker_new - ticker_old) / ticker_old * 100.0
    xbi_ret = (xbi_new - xbi_old) / xbi_old * 100.0
    gap = abs(ticker_ret - xbi_ret)

    # TODO: calibrare costante _ALIGNMENT_K su dati reali, valore provvisorio
    # High score = aligned with sector = external cause
    score = max(0.0, min(100.0, 100.0 - gap * _ALIGNMENT_K))

    return {
        "score": round(score, 1),
        "ticker_return_pct": round(ticker_ret, 2),
        "xbi_return_pct": round(xbi_ret, 2),
        "return_gap_pct": round(gap, 2),
        "status": "ok",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 2.1 — Regulatory Event Risk (binary flag from cluster D cash_veto or external)
# ──────────────────────────────────────────────────────────────────────────────

def compute_regulatory_event_risk(
    cluster_d_breakdown: dict[str, Any] | None = None,
    *,
    has_crl: bool = False,
    has_clinical_hold: bool = False,
) -> dict[str, Any]:
    """
    Score 0–100: recent regulatory adversity that makes recovery less likely.
    Reuses cluster D data if available. Binary flag sources from external signals.

    - CRL active: +60
    - Clinical hold: +40
    - Cash veto (from cluster D): +30 (dilution imminent)
    """
    score = 0.0
    flags: list[str] = []

    if has_crl:
        score += 60.0
        flags.append("CRL")
    if has_clinical_hold:
        score += 40.0
        flags.append("clinical_hold")
    if cluster_d_breakdown and cluster_d_breakdown.get("cash_veto"):
        score += 30.0
        flags.append("cash_veto")

    score = min(100.0, score)

    return {
        "score": round(score, 1) if flags else None,
        "flags": flags,
        "status": "ok" if flags else "no_event",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 2.2 — Cash Runway / Dilution Risk
# ──────────────────────────────────────────────────────────────────────────────

def compute_cash_runway_risk(
    cash_runway_months: float | None,
) -> dict[str, Any]:
    """
    Score 0–100: shorter runway → higher internal risk (dilution likely).

    Thresholds:
      < 6 months → 100 (critical)
      6–12 months → 70 (high)
      12–18 months → 40 (moderate)
      18–24 months → 20 (low)
      > 24 months → 0 (no risk)
      None → null (data unavailable)
    """
    if cash_runway_months is None:
        return {
            "score": None,
            "cash_runway_months": None,
            "status": "no_data",
        }

    if cash_runway_months < 6:
        score = 100.0
    elif cash_runway_months < 12:
        score = 70.0
    elif cash_runway_months < 18:
        score = 40.0
    elif cash_runway_months < 24:
        score = 20.0
    else:
        score = 0.0

    return {
        "score": round(score, 1),
        "cash_runway_months": round(cash_runway_months, 1),
        "status": "ok",
    }


# ──────────────────────────────────────────────────────────────────────────────
# 2.3 — News / Sentiment Flag
# ──────────────────────────────────────────────────────────────────────────────
# BLOCKED: No news feed connected to Supernova.
# Placeholder — returns null until a feed is integrated.

def compute_news_sentiment_flag() -> dict[str, Any]:
    """Placeholder — blocked for absence of data source."""
    return {
        "score": None,
        "status": "blocked_no_data_source",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Combined diagnostic output (for SDS integration)
# ──────────────────────────────────────────────────────────────────────────────

def compute_cause_attribution(
    closes: Sequence[float],
    volumes: Sequence[float],
    xbi_closes: Sequence[float],
    *,
    cash_runway_months: float | None = None,
    has_crl: bool = False,
    has_clinical_hold: bool = False,
    cluster_d_breakdown: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Compute all cause attribution indices, returning a combined diagnostic dict
    suitable for embedding in an SdsResult.

    Fields:
      - volume_anomaly: dict from compute_volume_anomaly
      - external_alignment: dict from compute_external_alignment
      - regulatory_event: dict from compute_regulatory_event_risk
      - cash_runway_risk: dict from compute_cash_runway_risk
      - news_sentiment: dict (placeholder, blocked)
      - internal_cause_flag: bool — True if volume anomaly high AND external alignment low
      - external_cause_flag: bool — True if external alignment high AND volume anomaly low
    """
    vol = compute_volume_anomaly(volumes)
    ext = compute_external_alignment(closes, xbi_closes)
    reg = compute_regulatory_event_risk(
        cluster_d_breakdown,
        has_crl=has_crl,
        has_clinical_hold=has_clinical_hold,
    )
    cash = compute_cash_runway_risk(cash_runway_months)
    news = compute_news_sentiment_flag()

    vol_score = vol["score"]
    ext_score = ext["score"]

    # Thresholds for flag classification
    # TODO: calibrare soglie su dati reali, valori provvisori
    internal_flag = (
        vol_score is not None
        and ext_score is not None
        and vol_score >= 60
        and ext_score < 40
    )
    external_flag = (
        ext_score is not None
        and vol_score is not None
        and ext_score >= 60
        and vol_score < 40
    )

    return {
        "volume_anomaly": vol,
        "external_alignment": ext,
        "regulatory_event": reg,
        "cash_runway_risk": cash,
        "news_sentiment": news,
        "internal_cause_flag": internal_flag,
        "external_cause_flag": external_flag,
    }
