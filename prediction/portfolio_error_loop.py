"""
Portfolio error loop (Learning Lab Phase 3).

Weekly snapshot: counterfactual P&L for equal vs score-weighted vs actual (mine)
allocations on closed sim positions. Proposes small deltas to the four sizing
parameters when weighted sizing underperforms equal over enough samples.

State: data/portfolio_sizing_calibration.json
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import DATA_DIR, INVESTMENT_SIM_OUTCOMES_JSON
from prediction.investment_sim_outcomes import read_investment_sim_outcomes

_CALIB_PATH = Path(DATA_DIR) / "portfolio_sizing_calibration.json"
_SCHEMA_VERSION = 1
_MIN_CLOSED = 5
_IMPROVE_DELTA_EUR = 50.0
_PARAM_STEP = 0.05

DEFAULT_PARAMS: dict[str, Any] = {
    "confidence_multipliers": {"low": 0.30, "medium": 0.70, "high": 1.0},
    "pattern_penalty": 0.5,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _save_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


def load_calibration_doc() -> dict[str, Any]:
    doc = _load_json(
        _CALIB_PATH,
        {
            "schema_version": _SCHEMA_VERSION,
            "updated_at": None,
            "params": dict(DEFAULT_PARAMS),
            "applied_params": dict(DEFAULT_PARAMS),
            "history": [],
            "pending_proposal": None,
        },
    )
    if not isinstance(doc, dict):
        return load_calibration_doc()
    doc.setdefault("schema_version", _SCHEMA_VERSION)
    doc.setdefault("params", dict(DEFAULT_PARAMS))
    doc.setdefault("applied_params", dict(doc["params"]))
    doc.setdefault("history", [])
    doc.setdefault("pending_proposal", None)
    return doc


def _confidence_tier(aff: float | None) -> Literal["low", "medium", "high"]:
    if aff is None or not math.isfinite(aff):
        return "medium"
    if aff < 60:
        return "low"
    if aff < 76:
        return "medium"
    return "high"


def _deal_score(row: dict[str, Any], params: dict[str, Any]) -> float:
    aff = row.get("affidabilita_pct")
    try:
        aff_f = float(aff) if aff is not None else 50.0
    except (TypeError, ValueError):
        aff_f = 50.0
    tier = _confidence_tier(aff_f)
    mul = float((params.get("confidence_multipliers") or DEFAULT_PARAMS["confidence_multipliers"])[tier])
    pred_raw = row.get("pred7_pp")
    if pred_raw is None:
        pred_raw = row.get("pred5_pp")
    try:
        pred = abs(float(pred_raw)) if pred_raw is not None else 5.0
    except (TypeError, ValueError):
        pred = 5.0
    win = max(0.05, min(0.95, aff_f / 100.0))
    ev = max(0.0, win * pred / 100.0)
    return ev * mul


def _closed_positions() -> list[dict[str, Any]]:
    doc = read_investment_sim_outcomes(INVESTMENT_SIM_OUTCOMES_JSON)
    rows = doc.get("rows") if isinstance(doc, dict) else []
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        pnl_pct = r.get("pnl_pct")
        cap = r.get("capital_eur")
        if pnl_pct is None or cap is None:
            continue
        try:
            if float(cap) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        if not (r.get("cd_passed") or r.get("outcome") in ("win", "loss", "flat")):
            continue
        out.append(r)
    return out


def _counterfactual_pnl(rows: list[dict[str, Any]], mode: str, params: dict[str, Any]) -> float | None:
    if not rows:
        return None
    total_cap = sum(float(r["capital_eur"]) for r in rows)
    n = len(rows)
    scores = [_deal_score(r, params) for r in rows]
    total_score = sum(scores)
    pnl = 0.0
    for r, sc in zip(rows, scores):
        if mode == "mine":
            cap = float(r["capital_eur"])
        elif mode == "equal":
            cap = total_cap / n
        else:  # weighted
            cap = total_cap * (sc / total_score) if total_score > 0 else total_cap / n
        pnl += cap * (float(r["pnl_pct"]) / 100.0)
    return round(pnl, 2)


def _verdict(weighted: float | None, equal: float | None, n: int) -> str:
    if n < _MIN_CLOSED:
        return "collecting_data"
    if weighted is None or equal is None:
        return "unknown"
    delta = weighted - equal
    if delta >= _IMPROVE_DELTA_EUR:
        return "improving"
    if delta <= -_IMPROVE_DELTA_EUR:
        return "not_helping"
    return "neutral"


def _build_proposal(
    params: dict[str, Any],
    weighted: float | None,
    equal: float | None,
    n: int,
) -> dict[str, Any] | None:
    if n < _MIN_CLOSED or weighted is None or equal is None:
        return None
    delta = weighted - equal
    if delta >= -_IMPROVE_DELTA_EUR:
        return None
    new_params = json.loads(json.dumps(params))
    cm = dict(new_params.get("confidence_multipliers") or DEFAULT_PARAMS["confidence_multipliers"])
    cm["medium"] = round(max(0.4, float(cm.get("medium", 0.7)) - _PARAM_STEP), 3)
    cm["low"] = round(max(0.15, float(cm.get("low", 0.3)) - _PARAM_STEP), 3)
    new_params["confidence_multipliers"] = cm
    pp = float(new_params.get("pattern_penalty", 0.5))
    new_params["pattern_penalty"] = round(max(0.25, pp - _PARAM_STEP), 3)
    return {
        "reason": (
            f"Weighted counterfactual ({weighted:.0f}€) below equal ({equal:.0f}€) "
            f"on n={n} closed trades — tighten confidence damping."
        ),
        "param_deltas": {
            "confidence_multipliers.medium": cm["medium"] - float(params["confidence_multipliers"]["medium"]),
            "confidence_multipliers.low": cm["low"] - float(params["confidence_multipliers"]["low"]),
            "pattern_penalty": new_params["pattern_penalty"] - pp,
        },
        "proposed_params": new_params,
    }


def run_snapshot(*, dry_run: bool = True) -> dict[str, Any]:
    doc = load_calibration_doc()
    params = doc.get("applied_params") or doc.get("params") or DEFAULT_PARAMS
    rows = _closed_positions()
    n = len(rows)

    scenarios = {
        "mine": _counterfactual_pnl(rows, "mine", params),
        "equal": _counterfactual_pnl(rows, "equal", params),
        "weighted": _counterfactual_pnl(rows, "weighted", params),
    }
    actual_realized = round(sum(float(r["pnl_eur"] or 0) for r in rows if r.get("pnl_eur") is not None), 2)

    entry = {
        "run_at": _now_iso(),
        "n_closed": n,
        "actual_realized_pnl_eur": actual_realized,
        "scenarios": scenarios,
        "weighted_vs_equal_delta_eur": (
            round(scenarios["weighted"] - scenarios["equal"], 2)
            if scenarios["weighted"] is not None and scenarios["equal"] is not None
            else None
        ),
        "verdict": _verdict(scenarios.get("weighted"), scenarios.get("equal"), n),
        "params_snapshot": params,
    }

    proposal = _build_proposal(params, scenarios.get("weighted"), scenarios.get("equal"), n)

    if not dry_run:
        history = list(doc.get("history") or [])
        history.append(entry)
        doc["history"] = history[-52:]
        doc["pending_proposal"] = proposal
        doc["updated_at"] = _now_iso()
        if proposal:
            doc["params"] = proposal["proposed_params"]
        _save_json(_CALIB_PATH, doc)

    return {
        "dry_run": dry_run,
        "snapshot": entry,
        "pending_proposal": proposal,
        "params": params,
    }


def preview_cycle() -> dict[str, Any]:
    return run_snapshot(dry_run=True)


def apply_cycle(*, confirm: bool = False) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm required"}
    result = run_snapshot(dry_run=True)
    proposal = result.get("pending_proposal")
    doc = load_calibration_doc()
    if proposal and proposal.get("proposed_params"):
        doc["applied_params"] = proposal["proposed_params"]
        doc["params"] = proposal["proposed_params"]
    doc["pending_proposal"] = None
    doc["updated_at"] = _now_iso()
    _save_json(_CALIB_PATH, doc)
    snap = run_snapshot(dry_run=False)
    return {"ok": True, "applied": bool(proposal), "snapshot": snap["snapshot"]}


def reset_calibration(*, confirm: bool = False) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm required"}
    doc = {
        "schema_version": _SCHEMA_VERSION,
        "updated_at": _now_iso(),
        "params": dict(DEFAULT_PARAMS),
        "applied_params": dict(DEFAULT_PARAMS),
        "history": [],
        "pending_proposal": None,
    }
    _save_json(_CALIB_PATH, doc)
    return {"ok": True, "dry_run": False}


def build_status_excerpt() -> dict[str, Any]:
    doc = load_calibration_doc()
    history = doc.get("history") if isinstance(doc.get("history"), list) else []
    latest = history[-1] if history else {}
    params = doc.get("applied_params") or doc.get("params") or DEFAULT_PARAMS
    pending = doc.get("pending_proposal")
    n = int(latest.get("n_closed") or 0) if isinstance(latest, dict) else 0
    verdict = str(latest.get("verdict") or "collecting_data") if isinstance(latest, dict) else "collecting_data"
    delta = latest.get("weighted_vs_equal_delta_eur") if isinstance(latest, dict) else None
    return {
        "doc": doc,
        "latest": latest,
        "params": params,
        "pending_proposal": pending,
        "n_closed": n,
        "verdict": verdict,
        "weighted_vs_equal_delta_eur": delta,
        "updated_at": doc.get("updated_at"),
    }
