"""
Read-only aggregation of the post-refresh calibration pipeline.

Surfaces outputs from modules that today run inside the orchestrator /
post_refresh_steps but are invisible in the legacy Learning Lab UI.
Does NOT re-run or modify any calibration logic.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _file_meta(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"available": False, "path": str(path.name)}
    try:
        st = path.stat()
        return {
            "available": True,
            "path": str(path.name),
            "mtime_iso": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).astimezone().isoformat(),
            "size_bytes": st.st_size,
        }
    except OSError:
        return {"available": False, "path": str(path.name)}


def build_learning_pipeline_overview() -> dict[str, Any]:
    data = Path(DATA_DIR)
    seq_doc = _load_json(data / "pred_curve_seq_state.json")
    pred_cal = _load_json(data / "pred_calibration.json")
    slope_doc = _load_json(data / "slope_contrarian_calib.json")
    v5_doc = _load_json(data / "pred_v5_calibration.json")
    model_state = _load_json(data / "model_calibration_state.json")

    cur = (model_state or {}).get("current") if isinstance(model_state, dict) else {}
    cf_block = (cur or {}).get("cal_factor") if isinstance(cur, dict) else {}
    global_cf = None
    if isinstance(cf_block, dict):
        try:
            v = cf_block.get("v4_options") or cf_block.get("v4")
            global_cf = float(v) if v is not None else None
        except (TypeError, ValueError):
            global_cf = None
    elif cf_block is not None:
        try:
            global_cf = float(cf_block)
        except (TypeError, ValueError):
            global_cf = None

    global_meta = _file_meta(data / "model_calibration_state.json")
    seq_events = 0
    if isinstance(seq_doc, dict):
        events = seq_doc.get("events")
        if isinstance(events, dict):
            seq_events = len(events)
        elif isinstance(events, list):
            seq_events = len(events)

    steps: list[dict[str, Any]] = [
        {
            "id": "raw_pred",
            "order": 0,
            "name_en": "Raw model prediction",
            "name_it": "Predizione grezza modello",
            "status": "active",
        },
        {
            "id": "seq_calib",
            "order": 1,
            "name_en": "Sequential curve anchor (seq_calib)",
            "name_it": "Ancoraggio curva sequenziale (seq_calib)",
            "status": "active" if seq_doc else "no_data",
            "meta": _file_meta(data / "pred_curve_seq_state.json"),
            "summary": {"anchored_events": seq_events},
        },
        {
            "id": "ai_feed_recalib",
            "order": 2,
            "name_en": "AI feed knot merge (pre-CD publications)",
            "name_it": "Merge knot AI feed (pubblicazioni pre-CD)",
            "status": "embedded_in_seq",
            "note_en": "Applied inside seq_calib when PRED_AI_FEED_SEQ_MERGE=1",
            "note_it": "Applicato dentro seq_calib quando PRED_AI_FEED_SEQ_MERGE=1",
        },
        {
            "id": "pred_calibration",
            "order": 3,
            "name_en": "Horizon bias (pred_calibration)",
            "name_it": "Bias per orizzonte (pred_calibration)",
            "status": "active" if pred_cal else "no_data",
            "meta": _file_meta(data / "pred_calibration.json"),
            "summary": {
                "direction_multiplier": pred_cal.get("direction_calib_multiplier") if pred_cal else None,
                "bias_d5": (
                    (pred_cal.get("bias") or {}).get("d5")
                    if pred_cal and isinstance(pred_cal.get("bias"), dict)
                    else None
                ),
            },
        },
        {
            "id": "slope_contrarian",
            "order": 4,
            "name_en": "Slope contrarian weight",
            "name_it": "Peso slope contrarian",
            "status": "active" if slope_doc else "no_data",
            "meta": _file_meta(data / "slope_contrarian_calib.json"),
            "summary": {
                "slope5d_weight": slope_doc.get("slope5d_weight") if slope_doc else None,
                "n_setups": slope_doc.get("n_setups") if slope_doc else None,
            },
        },
        {
            "id": "empirical_precat_blend",
            "order": 5,
            "name_en": "Empirical pre-CD blend",
            "name_it": "Blend empirico pre-CD",
            "status": "runtime_flag",
            "note_en": "PRED_EMP_PRECATAL_BLEND — applied at pred time",
            "note_it": "PRED_EMP_PRECATAL_BLEND — applicato a runtime",
        },
        {
            "id": "fundamental_shrink",
            "order": 6,
            "name_en": "Fundamental shrink (liquidity / beta)",
            "name_it": "Shrink fondamentale (liquidità / beta)",
            "status": "runtime",
            "note_en": "Per-row multiplier at pipeline time",
            "note_it": "Moltiplicatore per-riga a runtime",
        },
        {
            "id": "v5_fan_calibration",
            "order": 7,
            "name_en": "V5 fan sigma scale",
            "name_it": "Scala σ fan V5",
            "status": "active" if v5_doc else "no_data",
            "meta": _file_meta(data / "pred_v5_calibration.json"),
            "summary": {"sigma_scale": v5_doc.get("sigma_scale") if v5_doc else None},
        },
        {
            "id": "global_cal_factor",
            "order": 8,
            "name_en": "Global cal_factor (v4)",
            "name_it": "Global cal_factor (v4)",
            "status": "active" if global_cf is not None else "no_data",
            "meta": global_meta,
            "summary": {
                "value": global_cf,
                "read_only": True,
                "controlled_by": "orchestrator (~30d CALIB_REFRESH_DAYS)",
            },
        },
        {
            "id": "cluster_regime_display",
            "order": 9,
            "name_en": "Cluster CF + regime × (display)",
            "name_it": "Cluster CF + regime × (display)",
            "status": "learning_lab_weekly",
            "note_en": "Weekly learning cycle — display curve only",
            "note_it": "Ciclo settimanale Learning Lab — solo display curva",
        },
    ]

    return {
        "generated_at": _now_iso(),
        "steps": steps,
        "display_chain_en": "raw → seq → pred_calib → slope → emp_blend → fund_shrink → v5 → global CF → cluster/regime (display)",
        "display_chain_it": "grezzo → seq → pred_calib → slope → emp_blend → fund_shrink → v5 → global CF → cluster/regime (display)",
    }
