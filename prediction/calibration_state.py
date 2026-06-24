"""Server-side persistence for portfolio calibration loops (Learning Lab Phase 5)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

FROZEN_WEIGHTS_PATH = Path(DATA_DIR) / "calibration_frozen_weights.json"
PROPOSALS_PATH = Path(DATA_DIR) / "calibration_proposals.json"
FEATURE_SNAPSHOTS_PATH = Path(DATA_DIR) / "calibration_feature_snapshots.json"
SHRINKAGE_HISTORY_PATH = Path(DATA_DIR) / "calibration_shrinkage_history.json"
ADVICE_FEEDBACK_PATH = Path(DATA_DIR) / "advice_feedback_state.json"
_SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _save_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


def empty_frozen_weights() -> dict[str, Any]:
    return {
        "updatedAt": _now_iso(),
        "lastProposalId": None,
        "weights": {
            "clinicalPhase": {},
            "clinicalIndication": {},
            "sdsBucket": {},
            "pplanBucket": {},
        },
    }


def load_frozen_weights() -> dict[str, Any]:
    doc = _load_json(FROZEN_WEIGHTS_PATH, empty_frozen_weights())
    if not isinstance(doc, dict) or "weights" not in doc:
        return empty_frozen_weights()
    return doc


def save_frozen_weights(doc: dict[str, Any]) -> dict[str, Any]:
    doc = dict(doc)
    doc["updatedAt"] = _now_iso()
    _save_json(FROZEN_WEIGHTS_PATH, doc)
    return doc


def load_proposals() -> list[dict[str, Any]]:
    doc = _load_json(PROPOSALS_PATH, [])
    return doc if isinstance(doc, list) else []


def save_proposals(proposals: list[dict[str, Any]]) -> None:
    _save_json(PROPOSALS_PATH, proposals)


def append_proposal(proposal: dict[str, Any]) -> dict[str, Any]:
    all_p = load_proposals()
    all_p.append(proposal)
    save_proposals(all_p)
    return proposal


def update_proposal_status(
    proposal_id: str,
    status: str,
    *,
    review_note: str | None = None,
    reviewed_by: str | None = None,
) -> dict[str, Any] | None:
    all_p = load_proposals()
    for i, p in enumerate(all_p):
        if p.get("id") != proposal_id:
            continue
        if p.get("status") != "pending":
            return None
        updated = {
            **p,
            "status": status,
            "reviewedAt": _now_iso(),
            "reviewedBy": reviewed_by,
            "reviewNote": review_note,
        }
        all_p[i] = updated
        save_proposals(all_p)
        return updated
    return None


def list_pending_proposals() -> list[dict[str, Any]]:
    return [p for p in load_proposals() if p.get("status") == "pending"]


def apply_changes_to_frozen_weights(proposal_id: str, changes: list[dict[str, Any]]) -> dict[str, Any]:
    fw = load_frozen_weights()
    weights = fw.setdefault("weights", {})
    for ch in changes:
        dim = ch.get("dimension")
        cell = ch.get("cell")
        if not dim or not cell:
            continue
        dim_map = weights.setdefault(dim, {})
        dim_map[cell] = {
            "weight": ch.get("newWeight"),
            "n": ch.get("newN", 0),
            "confidence": ch.get("newConfidence", "low"),
        }
    fw["lastProposalId"] = proposal_id
    return save_frozen_weights(fw)


def load_feature_snapshots() -> dict[str, Any]:
    doc = _load_json(FEATURE_SNAPSHOTS_PATH, {})
    return doc if isinstance(doc, dict) else {}


def save_feature_snapshots(doc: dict[str, Any]) -> None:
    _save_json(FEATURE_SNAPSHOTS_PATH, doc)


def load_shrinkage_history() -> list[dict[str, Any]]:
    doc = _load_json(SHRINKAGE_HISTORY_PATH, [])
    return doc if isinstance(doc, list) else []


def append_shrinkage_history(entry: dict[str, Any]) -> None:
    hist = load_shrinkage_history()
    hist.append(entry)
    if len(hist) > 52:
        hist = hist[-52:]
    _save_json(SHRINKAGE_HISTORY_PATH, hist)


def load_advice_feedback_state() -> dict[str, Any]:
    doc = _load_json(
        ADVICE_FEEDBACK_PATH,
        {
            "schema_version": _SCHEMA_VERSION,
            "generatedAt": None,
            "scoredPoints": 0,
            "bucketCorrections": [],
            "actionDemotions": [],
        },
    )
    if not isinstance(doc, dict):
        return load_advice_feedback_state()
    doc.setdefault("schema_version", _SCHEMA_VERSION)
    doc.setdefault("bucketCorrections", [])
    doc.setdefault("actionDemotions", [])
    return doc


def save_advice_feedback_state(doc: dict[str, Any]) -> dict[str, Any]:
    doc = dict(doc)
    doc["schema_version"] = _SCHEMA_VERSION
    doc["generatedAt"] = doc.get("generatedAt") or _now_iso()
    _save_json(ADVICE_FEEDBACK_PATH, doc)
    return doc


def import_from_portfolio_snapshot(body: dict[str, Any]) -> None:
    """Merge desktop-synced snapshot into canonical server calibration state."""
    if body.get("frozen_weights"):
        save_frozen_weights(body["frozen_weights"])
    if body.get("calibration_proposals"):
        save_proposals(list(body["calibration_proposals"]))
    if body.get("advice_feedback"):
        af = body["advice_feedback"]
        if isinstance(af, dict):
            save_advice_feedback_state(
                {
                    "schema_version": _SCHEMA_VERSION,
                    "generatedAt": af.get("generatedAt"),
                    "scoredPoints": af.get("scoredPoints", 0),
                    "bucketCorrections": list(af.get("bucketCorrections") or []),
                    "actionDemotions": list(af.get("actionDemotions") or []),
                }
            )


def read_calibration_state() -> dict[str, Any]:
    return {
        "schema_version": _SCHEMA_VERSION,
        "updated_at": _now_iso(),
        "frozen_weights": load_frozen_weights(),
        "calibration_proposals": load_proposals(),
        "advice_feedback": load_advice_feedback_state(),
        "feature_snapshots": load_feature_snapshots(),
        "shrinkage_history": load_shrinkage_history()[-8:],
    }


def reset_frozen_weights() -> None:
    _save_json(FROZEN_WEIGHTS_PATH, empty_frozen_weights())


def reset_proposals() -> None:
    _save_json(PROPOSALS_PATH, [])


def reset_feature_snapshots() -> None:
    _save_json(FEATURE_SNAPSHOTS_PATH, {})


def reset_shrinkage_history() -> None:
    _save_json(SHRINKAGE_HISTORY_PATH, [])


def reset_advice_feedback() -> None:
    _save_json(
        ADVICE_FEEDBACK_PATH,
        {
            "schema_version": _SCHEMA_VERSION,
            "generatedAt": None,
            "scoredPoints": 0,
            "bucketCorrections": [],
            "actionDemotions": [],
        },
    )


def next_proposal_id() -> str:
    return f"prop-{uuid.uuid4().hex[:12]}"
