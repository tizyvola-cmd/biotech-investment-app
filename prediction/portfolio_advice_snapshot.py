"""
Server-side persistence for frontend Portfolio & Advice learning state (family C).

Schema mirrors localStorage keys used by the desktop UI:
  - supernova.calibration.proposals.v1
  - supernova.calibration.frozenWeights.v1
  - supernova.adviceFeedback.v1
  - supernova.riskPattern.* (proposals, approved, validation, flagged)

The desktop pushes its local snapshot via PUT; the Learning Lab reads via GET.
No automatic migration — explicit client sync only.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_SNAPSHOT_PATH = Path(DATA_DIR) / "portfolio_advice_snapshot.json"
_SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _empty_snapshot() -> dict[str, Any]:
    return {
        "schema_version": _SCHEMA_VERSION,
        "updated_at": None,
        "source": "empty",
        "calibration_proposals": [],
        "frozen_weights": None,
        "advice_feedback": None,
        "risk_pattern": {
            "proposals": [],
            "approved": None,
            "validation": {},
            "flagged": {},
        },
    }


def read_portfolio_advice_snapshot() -> dict[str, Any]:
    if not _SNAPSHOT_PATH.is_file():
        return _empty_snapshot()
    try:
        doc = json.loads(_SNAPSHOT_PATH.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            return _empty_snapshot()
        doc.setdefault("schema_version", _SCHEMA_VERSION)
        return doc
    except (OSError, json.JSONDecodeError):
        return _empty_snapshot()


def write_portfolio_advice_snapshot(body: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": _SCHEMA_VERSION,
        "updated_at": _now_iso(),
        "source": "desktop_sync",
        "calibration_proposals": body.get("calibration_proposals") or [],
        "frozen_weights": body.get("frozen_weights"),
        "advice_feedback": body.get("advice_feedback"),
        "risk_pattern": body.get("risk_pattern")
        or {
            "proposals": [],
            "approved": None,
            "validation": {},
            "flagged": {},
        },
    }
    _SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _SNAPSHOT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(_SNAPSHOT_PATH)
    from prediction.calibration_state import import_from_portfolio_snapshot

    import_from_portfolio_snapshot(payload)
    return {"ok": True, "updated_at": payload["updated_at"]}
