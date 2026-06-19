"""
SDS + existing pred curve → actionable investment decision (brief Part 5).
"""
from __future__ import annotations

from typing import Any

from prediction.supernova_score import SdsResult, SdsTickerInput


def investment_decision(inp: SdsTickerInput, sds: SdsResult) -> dict[str, Any]:
    regime = str(inp.market_regime or "NEUTRAL").upper()
    days_cd = inp.days_to_cd
    pred = inp.pred5_live
    conf = inp.confidence_score

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

    if pred is not None and conf is not None and (pred < 3.0 or conf < 0.75):
        return {
            "action": "HOLD",
            "label": "PRED ALIGNMENT",
            "position_size": "0%",
            "rationale": f"HOLD — pred {pred}% or conf {conf:.0%} insufficient",
            "sds_score": sds.sds,
            "sds_zone": sds.zone_label,
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
            f"pred T-5 {pred if pred is not None else '—'}% · "
            f"T-{days_cd if days_cd is not None else '?'} · "
            f"exit T-3…T-1 before CD"
        ),
        "exit_target": "T-3 to T-1 before CD (avoid binary event)",
        "stop_loss": "-15% from entry or SDS < 40",
        "sds_score": sds.sds,
        "sds_zone": sds.zone_label,
    }
