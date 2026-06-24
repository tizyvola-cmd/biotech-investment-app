"""
Calibration proposal engine (Learning Lab Phase 5).

Diffs fresh shrinkage snapshot vs frozen weights; proposals require explicit apply.
"""
from __future__ import annotations

from typing import Any

from prediction.bayesian_shrinkage import compute_calibration_snapshot
from prediction.calibration_state import (
    apply_changes_to_frozen_weights,
    append_proposal,
    list_pending_proposals,
    load_frozen_weights,
    load_proposals,
    next_proposal_id,
    reset_frozen_weights,
    reset_proposals,
    update_proposal_status,
)

DEFAULT_DELTA_EPSILON = 0.02

DIM_LABEL_EN = {
    "clinicalPhase": "Clinical phase",
    "clinicalIndication": "Indication",
    "sdsBucket": "SDS bucket",
    "pplanBucket": "P(plan) bucket",
}


def _generate_rationale(change: dict[str, Any], *, lang: str = "en") -> str:
    it = lang == "it"
    dim = change.get("dimension", "")
    cell = change.get("cell", "")
    old_w = change.get("oldWeight")
    new_w = change.get("newWeight")
    old_n = change.get("oldN", 0)
    new_n = change.get("newN", 0)
    label = DIM_LABEL_EN.get(dim, dim)
    if old_w is None:
        return (
            f"{label} · {cell}: prima osservazione win rate {new_w:.1%} su n={new_n}."
            if it
            else f"{label} · {cell}: first observation win rate {new_w:.1%} on n={new_n}."
        )
    delta_pp = abs(float(new_w) - float(old_w)) * 100
    direction = "raised" if float(new_w) > float(old_w) else "lowered"
    if it:
        direction = "alzato" if float(new_w) > float(old_w) else "abbassato"
        return f"{label} · {cell}: win rate {direction} da {float(old_w):.1%} a {float(new_w):.1%} — Δ {delta_pp:.1f}pp."
    return f"{label} · {cell}: win rate {direction} from {float(old_w):.1%} to {float(new_w):.1%} — Δ {delta_pp:.1f}pp."


def diff_snapshot_vs_frozen(
    snapshot: dict[str, Any],
    frozen: dict[str, Any],
    *,
    delta_epsilon: float = DEFAULT_DELTA_EPSILON,
    lang: str = "en",
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    fw = frozen.get("weights") or {}
    global_prior = float(snapshot.get("globalPrior") or 0.5)

    for dim, dim_est in (snapshot.get("dimensions") or {}).items():
        if not isinstance(dim_est, dict) or not dim_est.get("hasVariance"):
            continue
        for cell in dim_est.get("cells") or []:
            if not isinstance(cell, dict) or cell.get("inactive") == "no_data":
                continue
            frozen_entry = (fw.get(dim) or {}).get(cell.get("cell"))
            old_weight = frozen_entry.get("weight") if isinstance(frozen_entry, dict) else None
            old_n = int(frozen_entry.get("n") or 0) if isinstance(frozen_entry, dict) else 0
            old_conf = frozen_entry.get("confidence") if isinstance(frozen_entry, dict) else None
            new_weight = float(cell.get("shrinkageApplied") or 0)
            new_conf = cell.get("confidence") or "low"
            conf_changed = old_conf is not None and old_conf != new_conf
            weight_changed = old_weight is None or abs(new_weight - float(old_weight)) >= delta_epsilon
            if not conf_changed and not weight_changed:
                continue
            delta = new_weight - float(old_weight or global_prior)
            ch = {
                "dimension": dim,
                "cell": cell.get("cell"),
                "oldWeight": float(old_weight) if old_weight is not None else global_prior,
                "newWeight": new_weight,
                "delta": round(delta, 4),
                "oldN": old_n,
                "newN": int(cell.get("n") or 0),
                "oldConfidence": old_conf or "low",
                "newConfidence": new_conf,
                "confidenceChanged": conf_changed,
            }
            ch["rationale"] = _generate_rationale(ch, lang=lang)
            changes.append(ch)
    return changes


def preview_cycle(*, lang: str = "en") -> dict[str, Any]:
    snapshot = compute_calibration_snapshot()
    frozen = load_frozen_weights()
    changes = diff_snapshot_vs_frozen(snapshot, frozen, lang=lang)
    return {
        "ok": True,
        "dry_run": True,
        "changes": changes,
        "snapshot": snapshot,
        "pending_count": len(list_pending_proposals()),
    }


def apply_cycle(*, confirm: bool = True, lang: str = "en", proposal_id: str | None = None) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}

    if proposal_id:
        pending = [p for p in load_proposals() if p.get("id") == proposal_id and p.get("status") == "pending"]
        if not pending:
            return {"ok": False, "error": "proposal_not_found_or_not_pending"}
        proposal = pending[0]
    else:
        pending = list_pending_proposals()
        if pending:
            proposal = pending[0]
        else:
            snapshot = compute_calibration_snapshot()
            changes = diff_snapshot_vs_frozen(snapshot, load_frozen_weights(), lang=lang)
            if not changes:
                return {"ok": True, "dry_run": False, "changes": [], "message": "no_meaningful_changes"}
            proposal = append_proposal(
                {
                    "id": next_proposal_id(),
                    "createdAt": snapshot.get("computedAt"),
                    "triggeredByTradeId": None,
                    "changes": changes,
                    "status": "pending",
                }
            )

    updated = update_proposal_status(proposal["id"], "approved", reviewed_by="learning_lab_api")
    if not updated:
        return {"ok": False, "error": "approve_failed"}
    frozen = apply_changes_to_frozen_weights(updated["id"], updated.get("changes") or [])
    return {
        "ok": True,
        "dry_run": False,
        "changes": updated.get("changes") or [],
        "proposal": updated,
        "frozen_weights": frozen,
    }


def reset_calibration(*, confirm: bool = True) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}
    reset_proposals()
    reset_frozen_weights()
    return {"ok": True, "dry_run": False}


def build_status_excerpt() -> dict[str, Any]:
    pending = list_pending_proposals()
    fw = load_frozen_weights()
    cell_count = sum(len(v or {}) for v in (fw.get("weights") or {}).values())
    return {
        "pending_proposals": len(pending),
        "frozen_cells": cell_count,
        "last_proposal_id": fw.get("lastProposalId"),
        "updated_at": fw.get("updatedAt"),
    }
