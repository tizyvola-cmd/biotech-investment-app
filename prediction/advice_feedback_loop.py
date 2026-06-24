"""
Advice feedback loop (Learning Lab Phase 5).

Builds P(plan) bucket multipliers and action demotions from closed sim positions
(buy-signal proxy). Accepts synced desktop state via portfolio_advice_snapshot.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from prediction.bayesian_shrinkage import _closed_outcomes, _pplan_at_entry
from prediction.calibration_state import (
    load_advice_feedback_state,
    reset_advice_feedback,
    save_advice_feedback_state,
)

ADVICE_CALIB_BUCKETS = [
    {"id": "lt50", "labelEn": "<50%", "min": 0, "max": 49.999, "mid": 45},
    {"id": "50-59", "labelEn": "50–59%", "min": 50, "max": 59.999, "mid": 55},
    {"id": "60-69", "labelEn": "60–69%", "min": 60, "max": 69.999, "mid": 65},
    {"id": "70-79", "labelEn": "70–79%", "min": 70, "max": 79.999, "mid": 75},
    {"id": "80+", "labelEn": "80%+", "min": 80, "max": 100, "mid": 85},
]

MIN_BUCKET_SAMPLES = 5
MIN_ACTION_SAMPLES = 8
DEMOTE_BAD_RATE = 0.55
MULTIPLIER_MIN = 0.5
MULTIPLIER_MAX = 1.5
LOSS_THRESHOLD_PCT = -2.0


def _bucket_for_prob(prob_pct: float) -> dict[str, Any] | None:
    for b in ADVICE_CALIB_BUCKETS:
        if prob_pct >= b["min"] and prob_pct <= b["max"]:
            return b
    return ADVICE_CALIB_BUCKETS[-1]


def _clamp_multiplier(raw: float) -> float:
    if raw <= 0:
        return 1.0
    return max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, raw))


def _is_good_buy(row: dict[str, Any]) -> bool:
    try:
        return float(row.get("pnl_pct") or 0) > LOSS_THRESHOLD_PCT
    except (TypeError, ValueError):
        return False


def _build_points_from_outcomes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for row in rows:
        if not row.get("buy_signal") and not row.get("is_win"):
            continue
        prob = _pplan_at_entry(row)
        if prob is None:
            continue
        bucket = _bucket_for_prob(prob)
        if not bucket:
            continue
        good = _is_good_buy(row)
        points.append(
            {
                "id": row.get("row_key") or f"{row.get('ticker')}|{row.get('completion_date')}",
                "ticker": row.get("ticker"),
                "probPct": prob,
                "bucketId": bucket["id"],
                "bucketLabel": bucket["labelEn"],
                "outcome": "good" if good else "bad",
                "suggestedAction": "buy",
            }
        )
    return points


def _aggregate_bucket_rows(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_bucket: dict[str, dict[str, Any]] = {}
    for p in points:
        bid = p["bucketId"]
        slot = by_bucket.setdefault(
            bid,
            {
                "bucketId": bid,
                "bucketLabel": p["bucketLabel"],
                "bucketMid": (_bucket_for_prob(p["probPct"]) or {}).get("mid"),
                "count": 0,
                "goodCount": 0,
                "badCount": 0,
                "prob_sum": 0.0,
            },
        )
        slot["count"] += 1
        if p["outcome"] == "good":
            slot["goodCount"] += 1
        else:
            slot["badCount"] += 1
        slot["prob_sum"] += float(p["probPct"])

    rows = []
    for slot in by_bucket.values():
        scored = slot["goodCount"] + slot["badCount"]
        success = (100.0 * slot["goodCount"] / scored) if scored else None
        avg_prob = (slot["prob_sum"] / slot["count"]) if slot["count"] else None
        rows.append(
            {
                "bucketId": slot["bucketId"],
                "bucketLabel": slot["bucketLabel"],
                "bucketMid": slot["bucketMid"],
                "count": slot["count"],
                "goodCount": slot["goodCount"],
                "badCount": slot["badCount"],
                "pendingCount": 0,
                "successRatePct": round(success, 2) if success is not None else None,
                "avgProbPct": round(avg_prob, 2) if avg_prob is not None else None,
            }
        )
    return rows


def build_advice_feedback(
    points: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if points is None:
        points = _build_points_from_outcomes(_closed_outcomes())
    bucket_rows = _aggregate_bucket_rows(points)

    bucket_corrections: list[dict[str, Any]] = []
    for row in bucket_rows:
        scored = row["goodCount"] + row["badCount"]
        if scored < MIN_BUCKET_SAMPLES:
            continue
        if row["successRatePct"] is None or row["avgProbPct"] is None or row["avgProbPct"] <= 0:
            continue
        mult_raw = row["successRatePct"] / row["avgProbPct"]
        bucket_corrections.append(
            {
                "bucketId": row["bucketId"],
                "bucketLabel": row["bucketLabel"],
                "multiplier": round(_clamp_multiplier(mult_raw), 4),
                "multiplierRaw": round(mult_raw, 4),
                "samples": scored,
                "good": row["goodCount"],
                "bad": row["badCount"],
                "successRatePct": row["successRatePct"],
                "declaredAvgProbPct": row["avgProbPct"],
            }
        )

    action_groups: dict[str, dict[str, Any]] = {}
    for p in points:
        key = f"{p['bucketId']}|{p['suggestedAction']}"
        slot = action_groups.setdefault(
            key,
            {
                "bucketId": p["bucketId"],
                "bucketLabel": p["bucketLabel"],
                "action": p["suggestedAction"],
                "samples": 0,
                "bad": 0,
            },
        )
        slot["samples"] += 1
        if p["outcome"] == "bad":
            slot["bad"] += 1

    action_demotions: list[dict[str, Any]] = []
    for key, slot in action_groups.items():
        if slot["samples"] < MIN_ACTION_SAMPLES:
            continue
        bad_rate = slot["bad"] / slot["samples"]
        if bad_rate < DEMOTE_BAD_RATE:
            continue
        if slot["action"] == "review":
            continue
        action_demotions.append(
            {
                "bucketId": slot["bucketId"],
                "bucketLabel": slot["bucketLabel"],
                "from": slot["action"],
                "to": "review",
                "samples": slot["samples"],
                "badCount": slot["bad"],
                "badRate": round(bad_rate, 4),
                "dominantRootCause": None,
            }
        )

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "schema_version": 1,
        "generatedAt": now,
        "scoredPoints": len(points),
        "bucketCorrections": bucket_corrections,
        "actionDemotions": action_demotions,
    }


def apply_cycle(*, confirm: bool = True) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}
    doc = build_advice_feedback()
    save_advice_feedback_state(doc)
    return {
        "ok": True,
        "dry_run": False,
        "changes": doc.get("bucketCorrections") or [],
        "result": doc,
    }


def reset_calibration(*, confirm: bool = True) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}
    reset_advice_feedback()
    return {"ok": True, "dry_run": False}


def build_status_excerpt() -> dict[str, Any]:
    doc = load_advice_feedback_state()
    return {
        "generated_at": doc.get("generatedAt"),
        "scored_points": doc.get("scoredPoints", 0),
        "bucket_corrections": len(doc.get("bucketCorrections") or []),
        "action_demotions": len(doc.get("actionDemotions") or []),
    }
