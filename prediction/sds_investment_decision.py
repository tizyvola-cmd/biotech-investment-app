"""
SDS + existing pred curve → actionable investment decision (brief Part 5).
"""
from __future__ import annotations

from typing import Any

from prediction.supernova_score import SdsResult, SdsTickerInput

# ── Exit (SELL) thresholds — mirror the textual stop_loss/exit_target below ──
SELL_STOP_LOSS_PCT = -15.0  # PnL at/under this -> stop-loss exit
SELL_SDS_FLOOR = 40.0       # live SDS under this -> deterioration exit
SELL_PRE_CD_MIN_DAYS = 1    # T-1 … T-3 window before CD -> pre-event exit
SELL_PRE_CD_MAX_DAYS = 3


def sell_decision(
    *,
    pnl_pct: float | None,
    sds_live: float | None,
    days_to_cd: int | None,
) -> dict[str, Any] | None:
    """Exit rule for an OPEN position. Returns a SELL action with ``exit_reason``
    when a trigger fires, else ``None`` (hold the position).

    Thresholds mirror the ``stop_loss``/``exit_target`` guidance returned by
    :func:`investment_decision` ("-15% from entry or SDS < 40", "exit T-3…T-1").
    """
    if pnl_pct is not None and pnl_pct <= SELL_STOP_LOSS_PCT:
        return {"action": "SELL", "exit_reason": "stop_loss",
                "rationale": f"SELL — stop-loss (PnL {pnl_pct:.1f}% \u2264 {SELL_STOP_LOSS_PCT:.0f}%)"}
    if sds_live is not None and sds_live < SELL_SDS_FLOOR:
        return {"action": "SELL", "exit_reason": "sds_below_40",
                "rationale": f"SELL — SDS deterioration ({sds_live:.0f} < {SELL_SDS_FLOOR:.0f})"}
    if days_to_cd is not None and SELL_PRE_CD_MIN_DAYS <= days_to_cd <= SELL_PRE_CD_MAX_DAYS:
        return {"action": "SELL", "exit_reason": "pre_cd_exit",
                "rationale": f"SELL — pre-CD exit (T-{days_to_cd}, avoid binary event)"}
    return None


def classify_exit_reason(
    *,
    pnl_pct: float | None,
    sds_live: float | None,
    days_to_cd: int | None,
) -> str:
    """Label a realized exit by the SELL trigger that justified it, falling back
    to ``capital_removed`` when no rule-based trigger held at exit."""
    decision = sell_decision(pnl_pct=pnl_pct, sds_live=sds_live, days_to_cd=days_to_cd)
    return decision["exit_reason"] if decision else "capital_removed"


# Coin-flip floor: a reliability at/below this carries no directional information.
PRED_RELIABILITY_FLOOR_PCT = 50.0


def pred_reliability_weight(reliability_pct: float | None) -> float:
    """Linear weight with a 50% cutoff: ``w = clamp((R - 50) / 50, 0, 1)``.
    A reliability at/below the coin-flip floor zeroes the prediction; 100% keeps
    it full. Missing reliability -> 1.0 (neutral, no penalty)."""
    if reliability_pct is None:
        return 1.0
    try:
        r = float(reliability_pct)
    except (TypeError, ValueError):
        return 1.0
    return max(0.0, min(1.0, (r - PRED_RELIABILITY_FLOOR_PCT) / (100.0 - PRED_RELIABILITY_FLOOR_PCT)))


def _resolve_pred_reliability(days_to_cd: int | None) -> float | None:
    try:
        from prediction.sign_curve_daily import reliability_index_for_days_to_cd

        return reliability_index_for_days_to_cd(days_to_cd)
    except Exception:
        return None


def _resolve_pred_rating(days_to_cd: int | None) -> dict[str, Any] | None:
    """Full reliability classification (reliable-window membership + stars) for a
    prediction at ``days_to_cd``. ``None`` only on import/runtime failure."""
    try:
        from prediction.sign_curve_daily import reliability_rating_for_days_to_cd

        return reliability_rating_for_days_to_cd(days_to_cd)
    except Exception:
        return None


def investment_decision(
    inp: SdsTickerInput,
    sds: SdsResult,
    *,
    reliability_pct: float | None = None,
) -> dict[str, Any]:
    regime = str(inp.market_regime or "NEUTRAL").upper()
    days_cd = inp.days_to_cd
    pred = inp.pred5_live
    conf = inp.confidence_score
    rating = _resolve_pred_rating(days_cd)
    if reliability_pct is None:
        reliability_pct = (rating or {}).get("reliability_pct")
        if reliability_pct is None:
            reliability_pct = _resolve_pred_reliability(days_cd)
    reliable = (rating or {}).get("reliable")
    stars = (rating or {}).get("stars")
    peak_pct = (rating or {}).get("peak_pct")
    threshold_pct = (rating or {}).get("threshold_pct")
    weight = pred_reliability_weight(reliability_pct)
    pred_eff = round(pred * weight, 2) if pred is not None else None

    if sds.veto == "CASH_CRISIS":
        return {"action": "VETO", "label": "CASH CRISIS", "position_size": "0%", "rationale": sds.recommendation}
    if sds.veto == "MARKET_CRISIS":
        return {"action": "VETO", "label": "MARKET CRISIS", "position_size": "0%", "rationale": sds.recommendation}
    if regime in ("CRISIS", "RISK_OFF"):
        return {"action": "HOLD", "label": "MARKET GATE", "position_size": "0%", "rationale": "HOLD — market gate active"}

    if sds.sds < 55:
        return {
            "action": "WATCH",
            "label": "BELOW THRESHOLD",
            "position_size": "0%",
            "rationale": f"WATCH — SDS {sds.sds} below entry threshold (55)",
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
        }

    if days_cd is not None and (days_cd > 60 or days_cd < 14):
        return {
            "action": "WAIT",
            "label": "TIMING",
            "position_size": "0%",
            "rationale": f"WAIT — outside optimal window T-60…T-14 (currently T-{days_cd})",
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
        }

    if reliable is False:
        return {
            "action": "HOLD",
            "label": "NON AFFIDABILE",
            "position_size": "0%",
            "rationale": (
                f"HOLD — fuori finestra affidabile a T-{days_cd}: "
                f"R {reliability_pct:.0f}% < picco−10 ({threshold_pct:.0f}%) → nessuna stima"
            ),
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
            "pred_reliability_pct": reliability_pct,
            "pred_reliable": False,
            "pred_stars": None,
            "pred_peak_pct": peak_pct,
            "pred_effective": None,
        }

    if pred_eff is not None and conf is not None and (pred_eff < 3.0 or conf < 0.75):
        return {
            "action": "HOLD",
            "label": "PRED ALIGNMENT",
            "position_size": "0%",
            "rationale": (
                f"HOLD — pred {pred_eff}% (raw {pred}% × affidabilità {weight:.0%}) "
                f"or conf {conf:.0%} insufficient"
            ),
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
            "pred_reliability_pct": reliability_pct,
            "pred_reliable": reliable,
            "pred_stars": stars,
            "pred_peak_pct": peak_pct,
            "pred_effective": pred_eff,
        }

    if sds.veto == "BINARY_EVENT_LOCK":
        return {
            "action": "HOLD",
            "label": "BINARY LOCK",
            "position_size": "0%",
            "rationale": sds.recommendation or "HOLD — binary event lock",
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
        }

    if sds.sds >= 75:
        size = "FULL (3–5% portfolio)"
        label = "SUPERNOVA CANDIDATE"
    else:
        size = "HALF (1–2% portfolio)"
        label = "ENTRY"

    return {
        "action": label,
        "label": label,
        "position_size": size,
        "rationale": (
            f"SDS {sds.sds} ({sds.zone_label}) · "
            f"pred T-5 {pred_eff if pred_eff is not None else '—'}% "
            f"(raw {pred if pred is not None else '—'}% × affidabilità {weight:.0%}) · "
            f"T-{days_cd if days_cd is not None else '?'} · "
            f"exit T-3…T-1 before CD"
        ),
        "exit_target": "T-3 to T-1 before CD (avoid binary event)",
        "stop_loss": "-15% from entry or SDS < 40",
        "sds_score": sds.sds,
        "sds_zone": sds.zone_label,
        "pred_reliability_pct": reliability_pct,
        "pred_reliable": reliable,
        "pred_stars": stars,
        "pred_peak_pct": peak_pct,
        "pred_effective": pred_eff,
    }
