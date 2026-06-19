"""
Per-loop preview / apply / reset dispatcher (Learning Lab Phase 4–5).

Routes each registered loop id to the correct backend module. Frontend-only
loops return a structured hint instead of failing silently.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    CLUSTER_CAL_FACTORS_JSON,
    DATA_DIR,
    FEEDBACK_HISTORY_JSON,
    FEEDBACK_SUMMARY_JSON,
    LEARNING_HISTORY_JSON,
    REGIME_MULTIPLIERS_JSON,
    TICKER_PERFORMANCE_JSON,
)
from prediction.learning_bus import LOOPS_BY_ID

_FRONTEND_ONLY_HINT = {
    "hint_en": "This loop runs in the desktop browser (localStorage). Use the Portfolio tab → Calibration Center.",
    "hint_it": "Questo loop gira nel browser desktop (localStorage). Usa il tab Portfolio → Calibration Center.",
}

_WEEKLY_LOOP_IDS = frozenset({"cluster_cf", "regime_mult", "eis_super_score", "polygon_accuracy"})


def _unsupported(loop_id: str, action: str) -> dict[str, Any]:
    meta = LOOPS_BY_ID.get(loop_id)
    if meta and meta.schedule == "frontend_localstorage":
        return {
            "ok": False,
            "loop_id": loop_id,
            "action": action,
            "error": "frontend_only",
            **_FRONTEND_ONLY_HINT,
        }
    return {
        "ok": False,
        "loop_id": loop_id,
        "action": action,
        "error": "not_supported",
        "hint_en": f"Loop '{loop_id}' does not support {action} via API.",
        "hint_it": f"Il loop '{loop_id}' non supporta {action} via API.",
    }


def _cluster_diff(prev: dict, new_doc: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name, new_entry in (new_doc.get("clusters") or {}).items():
        old = (prev.get("clusters") or {}).get(name) or {}
        old_cf = old.get("cal_factor")
        new_cf = new_entry.get("cal_factor") if isinstance(new_entry, dict) else None
        if old_cf != new_cf and new_cf is not None:
            out.append(
                {
                    "cluster": name,
                    "from": old_cf,
                    "to": new_cf,
                    "bias_pp": new_entry.get("bias_pp"),
                    "n": new_entry.get("n_samples"),
                }
            )
    return out


def _regime_diff(prev: dict, new_doc: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for name, new_entry in (new_doc.get("regimes") or {}).items():
        old = (prev.get("regimes") or {}).get(name) or {}
        old_m = old.get("multiplier")
        if isinstance(new_entry, dict) and old_m != new_entry.get("multiplier") and new_entry.get("status") == "active":
            out.append(
                {
                    "regime": name,
                    "from": old_m,
                    "to": new_entry.get("multiplier"),
                    "bias_pp": new_entry.get("bias_pp"),
                    "n": new_entry.get("n"),
                }
            )
    return out


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    import json

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def preview_loop(loop_id: str) -> dict[str, Any]:
    meta = LOOPS_BY_ID.get(loop_id)
    if meta is None:
        return {"ok": False, "loop_id": loop_id, "action": "preview", "error": "unknown_loop"}
    if not meta.has_preview:
        return _unsupported(loop_id, "preview")

    if loop_id == "bayesian_shrinkage":
        from prediction.bayesian_shrinkage import preview_cycle

        doc = preview_cycle()
        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "preview",
            "dry_run": True,
            "changes": doc.get("changes") or [],
            "result": doc,
        }

    if loop_id == "proposal_engine":
        from prediction.calibration_proposal import preview_cycle

        doc = preview_cycle()
        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "preview",
            "dry_run": True,
            "changes": doc.get("changes") or [],
            "result": doc,
        }

    if loop_id == "portfolio_error_loop":
        from prediction.portfolio_error_loop import preview_cycle

        doc = preview_cycle()
        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "preview",
            "dry_run": True,
            "changes": [doc.get("pending_proposal")] if doc.get("pending_proposal") else [],
            "result": doc,
        }

    if loop_id == "validation_feedback":
        from prediction.validation_feedback_loop import run_now

        doc = run_now(dry_run=True)
        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "preview",
            "dry_run": True,
            "changes": doc.get("cal_factor_changes") or [],
            "result": doc,
        }

    if loop_id in _WEEKLY_LOOP_IDS:
        from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources, compute_cluster_cal_factors
        from prediction.regime_calibration import compute_regime_multipliers, resolve_regime_outcomes_for_learning

        outcomes = collect_resolved_outcomes_from_sources()
        regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
        prev_cluster = _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {})
        prev_regime = _load_json(Path(REGIME_MULTIPLIERS_JSON), {})

        changes: list[Any] = []
        result: dict[str, Any] = {"n_outcomes": len(outcomes)}

        if loop_id == "cluster_cf":
            cluster_doc = compute_cluster_cal_factors(outcomes, dry_run=True)
            changes = _cluster_diff(prev_cluster, cluster_doc)
            result["cluster_doc"] = cluster_doc
        elif loop_id == "regime_mult":
            regime_doc = compute_regime_multipliers(regime_outcomes, dry_run=True)
            changes = _regime_diff(prev_regime, regime_doc)
            result["regime_doc"] = regime_doc
        elif loop_id == "eis_super_score":
            from prediction.eis_super_score_learning import run_eis_super_score_learning_cycle

            eis = run_eis_super_score_learning_cycle(dry_run=True)
            changes = eis.get("changes") or []
            result["eis_super_score"] = eis
        elif loop_id == "polygon_accuracy":
            from prediction.cd_pattern_polygon_accuracy import (
                load_cd_pattern_polygon_accuracy,
                persist_cd_pattern_polygon_accuracy,
                polygon_mean_corr_changes,
            )

            prev_poly = load_cd_pattern_polygon_accuracy()
            poly_doc = persist_cd_pattern_polygon_accuracy(dry_run=True)
            changes = polygon_mean_corr_changes(prev_poly, poly_doc)
            result["cd_pattern_polygon"] = poly_doc

        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "preview",
            "dry_run": True,
            "changes": changes,
            "result": result,
            "note_en": "Global cal_factor (v4) is not modified by this action.",
            "note_it": "Il global cal_factor (v4) non viene modificato da questa azione.",
        }

    return _unsupported(loop_id, "preview")


def apply_loop(loop_id: str, *, confirm: bool = False) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "loop_id": loop_id, "action": "apply", "error": "confirm_required"}

    meta = LOOPS_BY_ID.get(loop_id)
    if meta is None:
        return {"ok": False, "loop_id": loop_id, "action": "apply", "error": "unknown_loop"}
    if not meta.has_apply:
        return _unsupported(loop_id, "apply")

    if loop_id == "bayesian_shrinkage":
        from prediction.bayesian_shrinkage import apply_cycle
        from prediction.learning_lab import append_learning_log

        doc = apply_cycle(confirm=True)
        if doc.get("ok"):
            append_learning_log("Applied Bayesian shrinkage snapshot", kind="bayesian_shrinkage", meta=doc.get("changes"))
        return {"ok": True, "loop_id": loop_id, "action": "apply", **doc}

    if loop_id == "proposal_engine":
        from prediction.calibration_proposal import apply_cycle
        from prediction.learning_lab import append_learning_log

        doc = apply_cycle(confirm=True)
        if doc.get("ok") and doc.get("changes"):
            append_learning_log(
                f"Approved proposal {doc.get('proposal', {}).get('id', '?')}",
                kind="proposal_engine",
                meta={"n_changes": len(doc.get("changes") or [])},
            )
        return {"ok": True, "loop_id": loop_id, "action": "apply", **doc}

    if loop_id == "advice_feedback":
        from prediction.advice_feedback_loop import apply_cycle
        from prediction.learning_lab import append_learning_log

        doc = apply_cycle(confirm=True)
        if doc.get("ok"):
            append_learning_log("Applied advice feedback", kind="advice_feedback", meta={"n_buckets": len(doc.get("changes") or [])})
        return {"ok": True, "loop_id": loop_id, "action": "apply", **doc}

    if loop_id == "portfolio_error_loop":
        from prediction.portfolio_error_loop import apply_cycle

        return {"ok": True, "loop_id": loop_id, "action": "apply", **apply_cycle(confirm=True)}

    if loop_id == "validation_feedback":
        from prediction.validation_feedback_loop import run_now

        doc = run_now(dry_run=False)
        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "apply",
            "dry_run": False,
            "changes": doc.get("cal_factor_changes") or [],
            "result": doc,
        }

    if loop_id in _WEEKLY_LOOP_IDS:
        from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources, compute_cluster_cal_factors
        from prediction.learning_lab import append_learning_log, snapshot_weekly_history
        from prediction.regime_calibration import compute_regime_multipliers, resolve_regime_outcomes_for_learning

        outcomes = collect_resolved_outcomes_from_sources()
        regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
        prev_cluster = _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {})
        prev_regime = _load_json(Path(REGIME_MULTIPLIERS_JSON), {})
        changes: list[Any] = []
        cluster_doc = prev_cluster
        regime_doc = prev_regime

        if loop_id == "cluster_cf":
            cluster_doc = compute_cluster_cal_factors(outcomes, dry_run=False)
            changes = _cluster_diff(prev_cluster, cluster_doc)
            for ch in changes:
                append_learning_log(
                    f"{ch['cluster']} cal_factor {ch['from']} → {ch['to']}",
                    kind="cluster_cf",
                    meta=ch,
                )
            snapshot_weekly_history(outcomes, cluster_doc, regime_doc)
        elif loop_id == "regime_mult":
            regime_doc = compute_regime_multipliers(regime_outcomes, dry_run=False)
            changes = _regime_diff(prev_regime, regime_doc)
            for ch in changes:
                append_learning_log(
                    f"{ch['regime']} multiplier {ch['from']} → {ch['to']}",
                    kind="regime_mult",
                    meta=ch,
                )
            snapshot_weekly_history(outcomes, cluster_doc, regime_doc)
        elif loop_id == "eis_super_score":
            from prediction.eis_super_score_learning import run_eis_super_score_learning_cycle

            eis = run_eis_super_score_learning_cycle(dry_run=False)
            changes = eis.get("changes") or []
            for ch in changes:
                append_learning_log(
                    f"EIS super {ch['window']} cal {ch['from']} → {ch['to']}",
                    kind="eis_super",
                    meta=ch,
                )
        elif loop_id == "polygon_accuracy":
            from prediction.cd_pattern_polygon_accuracy import (
                load_cd_pattern_polygon_accuracy,
                persist_cd_pattern_polygon_accuracy,
                polygon_mean_corr_changes,
            )

            prev_poly = load_cd_pattern_polygon_accuracy()
            poly_doc = persist_cd_pattern_polygon_accuracy(dry_run=False)
            changes = polygon_mean_corr_changes(prev_poly, poly_doc)
            for ch in changes:
                append_learning_log(
                    f"Polygon ρ mean {ch['from']} → {ch['to']}",
                    kind="polygon_match",
                    meta=ch,
                )

        return {
            "ok": True,
            "loop_id": loop_id,
            "action": "apply",
            "dry_run": False,
            "changes": changes,
            "note_en": "Global cal_factor (v4) is not modified by this action.",
            "note_it": "Il global cal_factor (v4) non viene modificato da questa azione.",
        }

    return _unsupported(loop_id, "apply")


def reset_loop(loop_id: str, *, confirm: bool = False) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "loop_id": loop_id, "action": "reset", "error": "confirm_required"}

    meta = LOOPS_BY_ID.get(loop_id)
    if meta is None:
        return {"ok": False, "loop_id": loop_id, "action": "reset", "error": "unknown_loop"}
    if not meta.has_reset:
        return _unsupported(loop_id, "reset")

    import json
    from datetime import datetime, timezone

    from prediction.learning_lab import append_learning_log

    def _now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    def _save(path: Path, doc: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)

    if loop_id == "bayesian_shrinkage":
        from prediction.bayesian_shrinkage import reset_calibration
        from prediction.learning_lab import append_learning_log

        doc = reset_calibration(confirm=True)
        append_learning_log("Reset Bayesian shrinkage", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", **doc}

    if loop_id == "proposal_engine":
        from prediction.calibration_proposal import reset_calibration
        from prediction.learning_lab import append_learning_log

        doc = reset_calibration(confirm=True)
        append_learning_log("Reset calibration proposals + frozen weights", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", **doc}

    if loop_id == "advice_feedback":
        from prediction.advice_feedback_loop import reset_calibration
        from prediction.learning_lab import append_learning_log

        doc = reset_calibration(confirm=True)
        append_learning_log("Reset advice feedback", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", **doc}

    if loop_id == "portfolio_error_loop":
        from prediction.portfolio_error_loop import reset_calibration

        return {"ok": True, "loop_id": loop_id, "action": "reset", **reset_calibration(confirm=True)}

    if loop_id == "validation_feedback":
        _save(Path(FEEDBACK_SUMMARY_JSON), {"version": 1, "reset": True, "updated_at": _now_iso()})
        _save(Path(FEEDBACK_HISTORY_JSON), {"version": 1, "weeks": []})
        _save(Path(TICKER_PERFORMANCE_JSON), {"version": 1, "updated_at": _now_iso(), "tickers": {}})
        append_learning_log("Reset validation feedback loop", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", "dry_run": False}

    if loop_id == "cluster_cf":
        _save(
            Path(CLUSTER_CAL_FACTORS_JSON),
            {"schema_version": 1, "generated_at": _now_iso(), "clusters": {}, "reset": True},
        )
        append_learning_log("Reset cluster cal_factor", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", "dry_run": False}

    if loop_id == "regime_mult":
        _save(
            Path(REGIME_MULTIPLIERS_JSON),
            {
                "schema_version": 1,
                "generated_at": _now_iso(),
                "regimes": {
                    r: {"multiplier": 1.0, "status": "insufficient_data", "n": 0}
                    for r in ("RISK_ON", "NEUTRAL", "RISK_OFF")
                },
                "reset": True,
            },
        )
        append_learning_log("Reset regime multipliers", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", "dry_run": False}

    if loop_id == "eis_super_score":
        from prediction.eis_super_score_learning import default_learning_state

        _save(Path(DATA_DIR) / "eis_super_score_learning.json", default_learning_state())
        append_learning_log("Reset EIS super score learning", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", "dry_run": False}

    if loop_id == "polygon_accuracy":
        from prediction.cd_pattern_polygon_accuracy import (
            POLYGON_ACCURACY_JSON,
            build_cd_pattern_polygon_overview,
        )

        poly_doc = build_cd_pattern_polygon_overview()
        poly_doc["learning_history"] = []
        _save(Path(POLYGON_ACCURACY_JSON), poly_doc)
        append_learning_log("Reset polygon accuracy learning history", kind="reset")
        return {"ok": True, "loop_id": loop_id, "action": "reset", "dry_run": False}

    return _unsupported(loop_id, "reset")