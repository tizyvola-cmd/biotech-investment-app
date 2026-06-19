"""
Persist ``*_fit_pct`` on past_catalyst_predictions rows and apply layer-i empirical blend.

``*_fit_pct`` = polinomio grezzo pre-blend (stesso spirito del live ``_fit_pre_eis``).
``model_dm*`` / ``d*_pct`` = valori post ``apply_empirical_precat_blend`` (layer i ON).

Chiamato dopo ``_enrich_past_pred_calib_empirical`` (serve ``emp_*`` / ``cal_factor``).
"""
from __future__ import annotations

import math
from typing import Any

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_document, rows_map_from_doc, save_predictions
from prediction.blend_ab_eval import (
    _FIT_KEY_FOR_MODEL,
    curve_cat_from_row,
    emp_shape_meta,
    has_fit_horizons,
)

MODEL_HORIZON_KEYS: tuple[str, ...] = tuple(_FIT_KEY_FOR_MODEL.keys())

FIT_PATCH_FIELDS: tuple[str, ...] = (
    *MODEL_HORIZON_KEYS,
    *(_FIT_KEY_FOR_MODEL[k] for k in MODEL_HORIZON_KEYS),
    "pred_dm5_fit_pct",
    "emp_precat_blend",
    "emp_precat_blend_lam",
    "emp_precat_blend_n",
    "emp_precat_blend_error",
)


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def snapshot_fit_horizons_from_model(rec: dict) -> bool:
    """Copy ``model_*`` → ``*_fit_pct`` when fit keys are missing. Returns True if patched."""
    if not isinstance(rec, dict):
        return False
    patched = False
    for mk, fk in _FIT_KEY_FOR_MODEL.items():
        if rec.get(fk) is not None:
            continue
        v = _num(rec.get(mk))
        if v is None:
            continue
        rec[fk] = round(v, 3)
        patched = True
    if rec.get("pred_dm5_fit_pct") is None and rec.get("model_dm5_fit_pct") is not None:
        rec["pred_dm5_fit_pct"] = rec["model_dm5_fit_pct"]
        patched = True
    return patched


def _record_needs_fit_enrich(rec: dict, *, force: bool) -> bool:
    if force:
        return has_fit_horizons(rec) or any(_num(rec.get(mk)) is not None for mk in MODEL_HORIZON_KEYS)
    if not has_fit_horizons(rec):
        if any(_num(rec.get(mk)) is not None for mk in MODEL_HORIZON_KEYS):
            return True
        return False
    if rec.get("emp_precat_blend") is None:
        return True
    return False


def enrich_past_pred_fit_horizons_record(
    rec: dict,
    calibration_state: dict | None,
    *,
    force: bool = False,
) -> bool:
    """Ensure fit horizons + apply empirical precat blend in-place."""
    if not isinstance(rec, dict):
        return False
    snapshot_fit_horizons_from_model(rec)
    if not _record_needs_fit_enrich(rec, force=force):
        return False
    if not has_fit_horizons(rec):
        return False

    from prediction.blend_ab_eval import pred_raw_fit_at_key
    from prediction.empirical_precat_blend import apply_empirical_precat_blend

    hz_in = {mk: pred_raw_fit_at_key(rec, mk) for mk in MODEL_HORIZON_KEYS}
    if not any(v is not None for v in hz_in.values()):
        return False

    try:
        hz_out, meta = apply_empirical_precat_blend(
            hz_in,
            calibration_state=calibration_state,
            ver="v4_options",
            curve_cat=curve_cat_from_row(rec),
            emp_shape_meta=emp_shape_meta(rec),
        )
    except Exception as exc:
        rec["emp_precat_blend"] = "error"
        rec["emp_precat_blend_error"] = str(exc)[:200]
        return True

    for mk, v in hz_out.items():
        if v is not None:
            rec[mk] = round(float(v), 3)
    rec["pred_dm5_fit_pct"] = rec.get("model_dm5_fit_pct")
    rec["emp_precat_blend"] = meta.get("emp_precat_blend")
    rec["emp_precat_blend_lam"] = meta.get("emp_precat_blend_lam")
    rec["emp_precat_blend_n"] = meta.get("emp_precat_blend_n")
    rec.pop("emp_precat_blend_error", None)
    return True


def enrich_past_pred_fit_horizons_metadata(
    pred_data: dict[str, dict] | None,
    calibration_state: dict | None,
    *,
    force: bool = False,
) -> int:
    if not pred_data:
        return 0
    n = 0
    for rec in pred_data.values():
        if enrich_past_pred_fit_horizons_record(rec, calibration_state, force=force):
            n += 1
    return n


def persist_past_pred_fit_patches(
    pred_data: dict[str, dict] | None,
    *,
    json_path: str | None = None,
) -> int:
    if not pred_data:
        return 0
    path = str(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    doc = load_past_pred_document(path)
    disk_rows = doc.get("rows")
    if not isinstance(disk_rows, dict):
        disk_rows = {}
        doc["rows"] = disk_rows

    n = 0
    for key, rec in pred_data.items():
        if not isinstance(rec, dict):
            continue
        target = disk_rows.get(str(key))
        if not isinstance(target, dict):
            continue
        patch = {f: rec[f] for f in FIT_PATCH_FIELDS if f in rec}
        if not patch:
            continue
        target.update(patch)
        n += 1

    if n > 0:
        save_predictions(doc, json_path=path)
    return n


def ensure_past_pred_fit_horizons_enriched(
    *,
    calibration_state: dict | None = None,
    persist: bool = True,
    force: bool = False,
    json_path: str | None = None,
) -> dict[str, int]:
    """Backfill all rows in past_catalyst_predictions.json (Accuracy / Q&C layer i)."""
    if calibration_state is None:
        try:
            from data_orchestrator import _load_calibration_state

            calibration_state = _load_calibration_state()
        except Exception:
            calibration_state = None

    path = str(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    doc = load_past_pred_document(path)
    rows = rows_map_from_doc(doc)
    n_updated = enrich_past_pred_fit_horizons_metadata(rows, calibration_state, force=force)
    n_persisted = 0
    if persist and n_updated:
        disk_rows = doc.setdefault("rows", {})
        for key, rec in rows.items():
            if str(key) not in disk_rows:
                continue
            patch = {f: rec[f] for f in FIT_PATCH_FIELDS if f in rec}
            if patch:
                disk_rows[str(key)].update(patch)
                n_persisted += 1
        if n_persisted:
            save_predictions(doc, json_path=path)
    return {"n_rows": len(rows), "n_updated": n_updated, "n_persisted": n_persisted}


__all__ = [
    "FIT_PATCH_FIELDS",
    "MODEL_HORIZON_KEYS",
    "enrich_past_pred_fit_horizons_metadata",
    "enrich_past_pred_fit_horizons_record",
    "ensure_past_pred_fit_horizons_enriched",
    "persist_past_pred_fit_patches",
    "snapshot_fit_horizons_from_model",
]
