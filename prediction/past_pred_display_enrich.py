"""
Persist display-layer metadata on past_catalyst_predictions rows:

  pred_dm5_fit_pct      — raw polynomial fit (same as model_dm5_pct at source)
  eis_poly_shift_pp     — additive EIS + clinical KPI shift at retro decision date
  cal_factor            — v4_options scale from calibration state
  model_dm5_display_pct — (fit + EIS) × cal_factor (what live Simulation shows)

``model_dm5_pct`` stays the raw fit for accuracy / delta columns.
"""
from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_document, rows_map_from_doc, save_predictions
from prediction.eis_poly_adjust import compute_eis_poly_shift_pp

_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_CALIB = _ROOT / "data" / "model_calibration_state.json"
RETRO_DECISION_DAYS_BEFORE_CD = 10

DISPLAY_PATCH_FIELDS = (
    "pred_dm5_fit_pct",
    "model_dm5_display_pct",
    "eis_poly_shift_pp",
    "eis_poly_agg",
    "eis_poly_extra_pp",
    "eis_poly_applied",
    "cal_factor",
)


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _parse_cd(rec: dict) -> date | None:
    cd = rec.get("completion_date")
    if hasattr(cd, "isoformat"):
        return cd
    if cd:
        s = str(cd).strip()[:10]
        if len(s) >= 10 and s[4] == "-":
            try:
                return date(int(s[:4]), int(s[5:7]), int(s[8:10]))
            except ValueError:
                return None
    return None


def cal_factor_v4_from_state(calib_path: Path | str | None = None) -> float:
    p = Path(calib_path or _DEFAULT_CALIB)
    if not p.is_file():
        return 1.0
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        cf = (doc.get("current") or {}).get("cal_factor") or {}
        v = float(cf.get("v4_options", 1.0))
        return v if v > 0 and math.isfinite(v) else 1.0
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 1.0


def cal_factor_v4_from_calibration_state(calibration_state: dict | None) -> float:
    if not isinstance(calibration_state, dict):
        return cal_factor_v4_from_state()
    try:
        cf = calibration_state.get("cal_factor") or {}
        if isinstance(cf, dict):
            v = float(cf.get("v4_options", 1.0))
            return v if v > 0 and math.isfinite(v) else cal_factor_v4_from_state()
    except (TypeError, ValueError):
        pass
    return cal_factor_v4_from_state()


def _record_needs_enrich(rec: dict, *, force: bool) -> bool:
    if force:
        return True
    if rec.get("pred_dm5_fit_pct") is None:
        return True
    if rec.get("cal_factor") is None:
        return True
    if "eis_poly_shift_pp" not in rec:
        return True
    return False


def enrich_past_pred_display_record(
    rec: dict,
    calibration_state: dict | None,
    *,
    ai_index: dict[str, dict[str, Any]] | None = None,
    ref_days_before_cd: int = RETRO_DECISION_DAYS_BEFORE_CD,
    force: bool = False,
) -> bool:
    """Add display metadata in-place. Returns True if row was updated."""
    if not isinstance(rec, dict):
        return False
    if not _record_needs_enrich(rec, force=force):
        return False

    fit = _num(rec.get("model_dm5_fit_pct")) or _num(rec.get("pred_dm5_fit_pct"))
    if fit is None:
        fit = _num(rec.get("model_dm5_pct"))
    if fit is None:
        return False

    cf = _num(rec.get("cal_factor"))
    if cf is None or cf <= 0:
        cf = cal_factor_v4_from_calibration_state(calibration_state)

    tk = str(rec.get("ticker") or "").strip().upper()
    cd = _parse_cd(rec)
    shift = 0.0
    eis_agg = None
    extra_pp = 0.0
    applied = False

    if tk and cd is not None:
        try:
            from prediction.ai_feed_recalib import build_prediction_clinical_signal

            ref_today = cd - timedelta(days=int(ref_days_before_cd))
            sig = build_prediction_clinical_signal(
                tk, cd, today=ref_today, index=ai_index
            )
            eis_agg = sig.get("eis_agg")
            extra_pp = float(sig.get("indicator_shift_pp") or 0.0)
            shift = compute_eis_poly_shift_pp(eis_agg, extra_pp=extra_pp)
            applied = abs(shift) > 1e-6
        except Exception:
            shift = 0.0

    post_eis = round(fit + shift, 3)
    display = round(post_eis * cf, 3)

    rec["pred_dm5_fit_pct"] = round(fit, 3)
    rec["cal_factor"] = round(cf, 4)
    rec["eis_poly_shift_pp"] = round(shift, 3)
    rec["eis_poly_agg"] = eis_agg
    rec["eis_poly_extra_pp"] = round(extra_pp, 3) if extra_pp else None
    rec["eis_poly_applied"] = applied
    rec["model_dm5_display_pct"] = display
    return True


def enrich_past_pred_display_metadata(
    pred_data: dict[str, dict] | None,
    calibration_state: dict | None,
    *,
    force: bool = False,
) -> int:
    """Enrich a rows map (or keyed dict) in place. Returns count updated."""
    if not pred_data:
        return 0
    ai_index = None
    try:
        from prediction.ai_feed_recalib import get_ai_feed_index

        ai_index = get_ai_feed_index()
    except Exception:
        ai_index = None

    n = 0
    for rec in pred_data.values():
        if enrich_past_pred_display_record(
            rec,
            calibration_state,
            ai_index=ai_index,
            force=force,
        ):
            n += 1
    return n


def persist_past_pred_display_patches(
    pred_data: dict[str, dict] | None,
    *,
    json_path: str | Path | None = None,
) -> int:
    """Merge display fields from ``pred_data`` into on-disk JSON."""
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
        patch = {f: rec[f] for f in DISPLAY_PATCH_FIELDS if f in rec}
        if not patch:
            continue
        target.update(patch)
        n += 1

    if n > 0:
        save_predictions(doc, json_path=path)
    return n


def ensure_past_pred_display_enriched(
    *,
    calibration_state: dict | None = None,
    persist: bool = True,
    force: bool = False,
    json_path: str | Path | None = None,
) -> dict[str, int]:
    """
    Backfill all rows in past_catalyst_predictions.json (used by Rebuild calibration).
    """
    path = str(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    doc = load_past_pred_document(path)
    rows = rows_map_from_doc(doc)
    n_updated = enrich_past_pred_display_metadata(rows, calibration_state, force=force)
    n_persisted = 0
    if persist and n_updated:
        disk_rows = doc.setdefault("rows", {})
        for key, rec in rows.items():
            if str(key) not in disk_rows:
                continue
            patch = {f: rec[f] for f in DISPLAY_PATCH_FIELDS if f in rec}
            if patch:
                disk_rows[str(key)].update(patch)
                n_persisted += 1
        if n_persisted:
            save_predictions(doc, json_path=path)
    return {"n_rows": len(rows), "n_updated": n_updated, "n_persisted": n_persisted}


__all__ = [
    "DISPLAY_PATCH_FIELDS",
    "RETRO_DECISION_DAYS_BEFORE_CD",
    "cal_factor_v4_from_calibration_state",
    "cal_factor_v4_from_state",
    "enrich_past_pred_display_metadata",
    "enrich_past_pred_display_record",
    "ensure_past_pred_display_enriched",
    "persist_past_pred_display_patches",
]
