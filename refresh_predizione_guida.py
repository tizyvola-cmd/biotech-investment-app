#!/usr/bin/env python3
"""
Rigenera solo il foglio «Predizione — guida» nel workbook Excel senza rieseguire
tutto data_orchestrator.

Usa ``prediction.refresh_coordinator`` (enrich NCT + coorte + scrittura foglio).

Uso (dalla cartella del progetto):
  python refresh_predizione_guida.py
  python refresh_predizione_guida.py --workbook data/biotech_orchestrated_output.xlsx
  python refresh_predizione_guida.py --json data/past_catalyst_predictions.json

PowerShell:
  & .venv\\Scripts\\python.exe refresh_predizione_guida.py

Se compare coorte vuota dopo filtro NCT, vedere ``PRED_NCT_STRICT`` in ``prediction/config.py``
o ``--skip-nct-relation-filter``.

Dopo ``seq_curve enrich 700/784`` il processo può restare **senza output** per molti minuti:
sta scaricando i filing SEC 8-K (una richiesta per CIK). Per accelerare::

  set ORCH_SKIP_SEC_K8=1
  python refresh_predizione_guida.py

Per μ/σ aggiornate su «Predizione — guida» (cluster 0/1, rialzo/ribasso post-CD),
non usare ``ACCURACY_REFRESH_FAST=1`` (serve HistLib sui close sessione).

  py -3 refresh_predizione_guida.py

Dopo modifiche al JSON / orchestrator, rieseguire questo script con Excel chiuso.
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _load_past_pred_map(json_path: str) -> dict:
    from past_pred_io import load_past_pred_map as _lpm
    return _lpm(json_path)


def main() -> int:
    from orchestrator_io_paths import FINAL_XLSX, PAST_CATALYST_PREDICTIONS_JSON
    from prediction.refresh_coordinator import run_prediction_refresh

    ap = argparse.ArgumentParser(description="Refresh foglio «Predizione — guida».")
    ap.add_argument(
        "--workbook",
        default=FINAL_XLSX,
        help=f"Percorso .xlsx da aggiornare (default: {FINAL_XLSX})",
    )
    ap.add_argument(
        "--json",
        default=PAST_CATALYST_PREDICTIONS_JSON,
        help=f"Sorgente past pred (default: {PAST_CATALYST_PREDICTIONS_JSON})",
    )
    ap.add_argument(
        "--skip-nct-relation-filter",
        action="store_true",
        help=(
            "Non applicare il filtro relazione NCT ristretta per la coorte primaria."
        ),
    )
    ap.add_argument(
        "--check-alignment",
        action="store_true",
        help="Dopo il refresh, confronta chiavi JSON vs foglio Simulation.",
    )
    args = ap.parse_args()

    if not os.path.isfile(args.workbook):
        print(f"[PredizioneGuida] ERRORE: workbook non trovato: {args.workbook}", file=sys.stderr)
        return 1
    if not os.path.isfile(args.json):
        print(f"[PredizioneGuida] ERRORE: JSON past pred non trovato: {args.json}", file=sys.stderr)
        return 1

    report = run_prediction_refresh(
        "guida",
        workbook_path=os.path.abspath(args.workbook),
        json_path=os.path.abspath(args.json),
        skip_nct_filter=args.skip_nct_relation_filter,
        check_alignment=args.check_alignment,
        project_root=_ROOT,
    )
    print(
        f"[PredizioneGuida] Record: pre-filtro={report.records_in} | "
        f"coorte={report.cohort_size} | filtro NCT: "
        f"{'OFF' if not report.nct_filter_applied else 'ON'}",
    )
    for w in report.warnings:
        print(f"[PredizioneGuida] {w}", file=sys.stderr)
    if report.excel_written and not report.cohort_empty:
        print(f"[PredizioneGuida] Sheet aggiornato → {os.path.abspath(args.workbook)}")
    elif report.cohort_empty:
        print(
            "[PredizioneGuida] Coorte vuota — foglio guida non sovrascritto "
            "(banner se possibile).",
            file=sys.stderr,
        )
    return report.exit_code()


if __name__ == "__main__":
    raise SystemExit(main())
