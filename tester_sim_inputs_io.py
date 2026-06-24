"""
Portfolio simulazione per tester mobile — un file JSON per ``tester_id`` (email).

Separato da ``data/invest_sim_inputs.json`` (desktop / Decision Lab).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from orchestrator_io_paths import DATA_DIR
from tester_feedback_io import _clean_tester_id, _ensure_tester_access, get_tester_access

TESTER_SIM_INPUTS_DIR = os.path.join(DATA_DIR, "tester_sim_inputs")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path_for(tester_id: str) -> str:
    tid = _clean_tester_id(tester_id)
    os.makedirs(TESTER_SIM_INPUTS_DIR, exist_ok=True)
    return os.path.join(TESTER_SIM_INPUTS_DIR, f"{tid}.json")


def load_sim_inputs(tester_id: str) -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    p = _path_for(tid)
    if not os.path.isfile(p):
        return {"version": 1, "tester_id": tid, "updated_at": None, "inputs": {}}
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "tester_id": tid, "updated_at": None, "inputs": {}}
    if not isinstance(data, dict):
        return {"version": 1, "tester_id": tid, "updated_at": None, "inputs": {}}
    inputs = data.get("inputs")
    if not isinstance(inputs, dict):
        data["inputs"] = {}
    data.setdefault("version", 1)
    data.setdefault("tester_id", tid)
    return data


def save_sim_inputs(tester_id: str, inputs: dict[str, Any], *, source: str = "mobile") -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    _ensure_tester_access(tid, source)
    if not isinstance(inputs, dict):
        raise ValueError("inputs deve essere un oggetto")
    payload = {
        "version": 1,
        "tester_id": tid,
        "updated_at": _now_iso(),
        "inputs": inputs,
    }
    p = _path_for(tid)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, p)
    return payload


def delete_sim_inputs(tester_id: str) -> bool:
    tid = _clean_tester_id(tester_id)
    p = _path_for(tid)
    if os.path.isfile(p):
        os.remove(p)
        return True
    return False


def sim_inputs_summary(tester_id: str) -> dict[str, Any]:
    doc = load_sim_inputs(tester_id)
    inputs = doc.get("inputs") if isinstance(doc.get("inputs"), dict) else {}
    open_count = 0
    closed_count = 0
    open_capital = 0.0
    for entry in inputs.values():
        if not isinstance(entry, dict):
            continue
        cap = float(entry.get("capital") or 0)
        if entry.get("ignoreSheet"):
            if cap > 0 or float(entry.get("closedPnlEur") or 0) != 0:
                closed_count += 1
            continue
        if cap > 0:
            open_count += 1
            open_capital += cap
    access = get_tester_access(tester_id)
    return {
        "tester_id": _clean_tester_id(tester_id),
        "email": access.get("email") or "",
        "display_name": access.get("display_name") or "",
        "updated_at": doc.get("updated_at"),
        "store_path": _path_for(_clean_tester_id(tester_id)),
        "open_positions": open_count,
        "closed_positions": closed_count,
        "open_capital_eur": round(open_capital, 2),
    }
