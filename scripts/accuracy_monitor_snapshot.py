#!/usr/bin/env python3
"""
Accoda uno snapshot al monitor «Accuratezza nel tempo» e opzionalmente aggiorna il foglio Excel.

Coorte: retro (opz.) ∪ Catalyst Completati da ``past_catalyst_predictions.json``,
filtro relazioni NCT ristretto — stessa logica di ``save_final_outputs``.

Uso:
  python scripts/accuracy_monitor_snapshot.py
  python scripts/accuracy_monitor_snapshot.py --trigger post_model_check
  python scripts/accuracy_monitor_snapshot.py --workbook data/biotech_orchestrated_output.xlsx --write-sheet
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _build_pooled_restricted(
    json_path: str,
    *,
    retro_results: list | None = None,
    past_pred_rows: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    from data_orchestrator import (
        _filter_records_by_restricted_nct_relation,
        _merge_retro_and_catalyst_predictions,
        _model_accuracy_metrics_eligible,
        _model_records_from_past_pred,
    )
    from past_pred_io import load_past_pred_map

    _ppm = past_pred_rows if past_pred_rows is not None else load_past_pred_map(json_path)
    _cat = _model_records_from_past_pred(_ppm)
    _merged = _merge_retro_and_catalyst_predictions(retro_results or [], _cat)
    _restricted = _filter_records_by_restricted_nct_relation(_merged)
    _eligible = [r for r in _restricted if _model_accuracy_metrics_eligible(r)]
    return _restricted, _eligible


def main() -> int:
    from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON
    from past_pred_io import default_past_pred_json

    ap = argparse.ArgumentParser(description="Snapshot monitor accuratezza pooled v4.")
    ap.add_argument("--workbook", default=FINAL_XLSX)
    ap.add_argument("--json", default=default_past_pred_json(_ROOT))
    ap.add_argument(
        "--trigger",
        default="post_model_check",
        help="Codice motivo snapshot (es. post_model_check, forced_model_change)",
    )
    ap.add_argument(
        "--write-sheet",
        action="store_true",
        help="Riscrive il foglio «📈 Accuratezza nel tempo» nel workbook.",
    )
    ap.add_argument(
        "--recalibrated",
        action="store_true",
        help="Marca lo snapshot come post-ricalibrazione.",
    )
    args = ap.parse_args()

    if not os.path.isfile(args.json):
        print(f"[AccSnapshot] ERRORE: JSON non trovato: {args.json}", file=sys.stderr)
        return 1

    from data_orchestrator import (
        _accuracy_monitor_append_entry,
        _accuracy_monitor_load,
        _load_calibration_state,
        _past_pred_disk_load,
        write_accuracy_monitor_sheet,
        write_accuracy_temporal_sheet,
    )
    from orchestrator_io_paths import FINAL_JSON
    from past_pred_io import load_past_pred_document, rows_map_from_doc
    from prediction.enrich import enrich_past_pred_accuracy_metadata

    _doc = load_past_pred_document(args.json)
    _rows = rows_map_from_doc(_doc)
    try:
        enrich_past_pred_accuracy_metadata(
            _rows,
            workbook_path=args.workbook,
            json_path=FINAL_JSON,
        )
    except Exception as _enr_exc:
        print(
            f"[AccSnapshot] enrich metadata (non bloccante): {_enr_exc}",
            flush=True,
        )

    _restricted, _eligible = _build_pooled_restricted(
        args.json,
        past_pred_rows=_rows,
    )
    _n_json = len((_past_pred_disk_load().get("rows") or {}))
    _calib = _load_calibration_state()

    _before = len((_accuracy_monitor_load().get("entries") or []))
    if not _eligible:
        print(
            "[AccSnapshot] Coorte eleggibile vuota — snapshot non accodato "
            "(verificare enrich e model_inputs_present_n nel JSON).",
            file=sys.stderr,
            flush=True,
        )
        snap = {}
    else:
        snap = _accuracy_monitor_append_entry(
            _restricted,
            n_past_pred_rows=_n_json,
            calibration_state=_calib,
            recalibrated=bool(args.recalibrated),
            snapshot_trigger=str(args.trigger),
        )
    _after = len((_accuracy_monitor_load().get("entries") or []))

    print(
        f"[AccSnapshot] Coorte: {len(_restricted)} righe | "
        f"eleggibili metriche: {len(_eligible)} | "
        f"ok_v4 valutabili: {snap.get('n_evaluable_ok_v4')} | "
        f"Acc% v4: {snap.get('acc_v4_pct')} | "
        f"Δpp vs prec.: {snap.get('delta_pp_vs_prev')}",
        flush=True,
    )
    print(
        f"[AccSnapshot] Storico: {_before} → {_after} righe (trigger={args.trigger!r})",
        flush=True,
    )

    if args.write_sheet:
        if not os.path.isfile(args.workbook):
            print(
                f"[AccSnapshot] Workbook non trovato — snapshot JSON ok, foglio saltato: "
                f"{args.workbook}",
                file=sys.stderr,
            )
            return 0
        from openpyxl import load_workbook

        _skip_old = os.environ.pop("SKIP_ACCURACY_MONITOR", None)
        try:
            wb = load_workbook(args.workbook, read_only=False, data_only=False)
            write_accuracy_monitor_sheet(wb)
            write_accuracy_temporal_sheet(wb)
            wb.save(args.workbook)
            print(
                f"[AccSnapshot] Fogli monitor + Accuratezza temporale → "
                f"{os.path.abspath(args.workbook)}"
            )
        finally:
            if _skip_old is not None:
                os.environ["SKIP_ACCURACY_MONITOR"] = _skip_old

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
