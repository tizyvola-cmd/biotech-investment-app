"""
Esegue uno snapshot manuale del monitor «Accuratezza nel tempo»
(stesso flusso di scripts/accuracy_monitor_snapshot.py).
"""
from __future__ import annotations

import os
from typing import Any


def run_accuracy_monitor_snapshot(
    *,
    trigger: str = "manual_ui",
    write_sheet: bool = False,
    recalibrated: bool = False,
    project_root: str | None = None,
) -> dict[str, Any]:
    """
    Accoda una riga a model_accuracy_monitor_history.json.

    Returns dict with ok, message, snapshot fields, entries_before/after.
    """
    root = project_root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    from orchestrator_io_paths import FINAL_JSON, FINAL_XLSX
    from past_pred_io import default_past_pred_json, load_past_pred_document, rows_map_from_doc
    from data_orchestrator import (
        _accuracy_monitor_append_entry,
        _accuracy_monitor_load,
        _filter_records_by_restricted_nct_relation,
        _merge_retro_and_catalyst_predictions,
        _load_calibration_state,
        _model_accuracy_metrics_eligible,
        _model_records_from_past_pred,
        _past_pred_disk_load,
        write_accuracy_monitor_sheet,
        write_accuracy_temporal_sheet,
    )
    from prediction.enrich import enrich_past_pred_accuracy_metadata

    json_path = default_past_pred_json(root)
    if not os.path.isfile(json_path):
        return {
            "ok": False,
            "error": f"JSON non trovato: {json_path}",
        }

    doc = load_past_pred_document(json_path)
    rows = rows_map_from_doc(doc)
    enrich_error: str | None = None
    try:
        enrich_past_pred_accuracy_metadata(
            rows,
            workbook_path=FINAL_XLSX,
            json_path=FINAL_JSON,
        )
    except Exception as exc:
        enrich_error = str(exc)

    ppm = rows
    cat = _model_records_from_past_pred(ppm)
    merged = _merge_retro_and_catalyst_predictions([], cat)
    restricted = _filter_records_by_restricted_nct_relation(merged)
    eligible = [r for r in restricted if _model_accuracy_metrics_eligible(r)]
    n_json = len((_past_pred_disk_load().get("rows") or {}))
    calib = _load_calibration_state()

    before = len((_accuracy_monitor_load().get("entries") or []))
    if not eligible:
        _hint = (
            " Nessun record con relazione NCT ristretta dopo il filtro coorte."
            if len(restricted) == 0 and len(cat) > 0
            else ""
        )
        return {
            "ok": False,
            "error": (
                "Coorte eleggibile vuota — verificare past_catalyst_predictions "
                f"e model_inputs_present_n.{_hint}"
            ),
            "n_restricted": len(restricted),
            "n_eligible": 0,
            "n_catalyst_records": len(cat),
            "entries_before": before,
            "entries_after": before,
            "enrich_warning": enrich_error,
        }

    snap = _accuracy_monitor_append_entry(
        restricted,
        n_past_pred_rows=n_json,
        calibration_state=calib,
        recalibrated=bool(recalibrated),
        snapshot_trigger=str(trigger),
    )
    after = len((_accuracy_monitor_load().get("entries") or []))

    if not snap:
        return {
            "ok": False,
            "error": "Snapshot non accodato (nessun ok_v4 valutabile).",
            "n_restricted": len(restricted),
            "n_eligible": len(eligible),
            "entries_before": before,
            "entries_after": after,
            "enrich_warning": enrich_error,
        }

    sheet_written = False
    sheet_error: str | None = None
    if write_sheet and os.path.isfile(FINAL_XLSX):
        try:
            from openpyxl import load_workbook

            skip_old = os.environ.pop("SKIP_ACCURACY_MONITOR", None)
            try:
                wb = load_workbook(FINAL_XLSX, read_only=False, data_only=False)
                write_accuracy_monitor_sheet(wb)
                write_accuracy_temporal_sheet(wb)
                wb.save(FINAL_XLSX)
                sheet_written = True
            finally:
                if skip_old is not None:
                    os.environ["SKIP_ACCURACY_MONITOR"] = skip_old
        except Exception as exc:
            sheet_error = str(exc)

    return {
        "ok": True,
        "trigger": trigger,
        "n_restricted": len(restricted),
        "n_eligible": len(eligible),
        "entries_before": before,
        "entries_after": after,
        "snapshot": snap,
        "sheet_written": sheet_written,
        "sheet_error": sheet_error,
        "enrich_warning": enrich_error,
    }
