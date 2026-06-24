#!/usr/bin/env python3
"""
Rigenera il foglio **Accuracy** nel workbook senza eseguire tutto ``data_orchestrator``.

Usa ``prediction.refresh_coordinator`` (enrich + coorte NCT + calib empirica + sheet).

Uso:
  python refresh_accuracy_modello.py
  python refresh_accuracy_modello.py --live-sim-pred
  python refresh_accuracy_modello.py --workbook data/biotech_orchestrated_output.xlsx
  python refresh_accuracy_modello.py --skip-nct-relation-filter

PowerShell:
  Set-Location \"...\\Biotech_Investment app 6\"; python refresh_accuracy_modello.py
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _abspath_project(p: str) -> str:
    if not (p or "").strip():
        return p
    p = os.path.expanduser(p.strip())
    return os.path.normpath(p if os.path.isabs(p) else os.path.join(_ROOT, p))


def main() -> int:
    from past_pred_io import default_final_xlsx, default_past_pred_json
    from prediction.refresh_coordinator import run_prediction_refresh

    ap = argparse.ArgumentParser(
        description="Refresh foglio «Accuracy» (ex Accuratezza Simulation).",
    )
    ap.add_argument(
        "--workbook",
        default=default_final_xlsx(_ROOT),
        help=f"Percorso .xlsx (default: {default_final_xlsx(_ROOT)})",
    )
    ap.add_argument(
        "--json",
        default=default_past_pred_json(_ROOT),
        help=f"past_catalyst_predictions.json (default: {default_past_pred_json(_ROOT)})",
    )
    ap.add_argument(
        "--skip-nct-relation-filter",
        action="store_true",
        help="Disattiva filtro relazione NCT ristretta.",
    )
    ap.add_argument(
        "--only-accuracy-simulation",
        action="store_true",
        help="(Deprecato, ignorato) — si aggiorna solo il foglio Accuracy.",
    )
    ap.add_argument(
        "--no-live-sim-pred",
        action="store_true",
        help="Salta ricalcolo curve v4 live (solo JSON esistente; Pred può restare piatta).",
    )
    ap.add_argument(
        "--full-json-enrich",
        action="store_true",
        help="Enrich metadata CT.gov su tutto il JSON (lento). Default: ACCURACY_REFRESH_FAST=1.",
    )
    ap.add_argument(
        "--check-alignment",
        action="store_true",
        help="Confronto leggero JSON vs Simulation dopo il refresh.",
    )
    args = ap.parse_args()
    args.workbook = _abspath_project(args.workbook)
    args.json = _abspath_project(args.json)

    if not os.path.isfile(args.workbook):
        print(f"[Accuracy] ERRORE: workbook non trovato: {args.workbook}", file=sys.stderr)
        return 1
    if not os.path.isfile(args.json):
        print(f"[Accuracy] ERRORE: JSON non trovato: {args.json}", file=sys.stderr)
        return 1

    _live = not args.no_live_sim_pred
    os.environ.setdefault("ACC_SIM_BULK_PAST_WRITE", "0")
    os.environ.setdefault("PRED_CURVE_SEQ_CALIB", "1")
    os.environ.setdefault("SEC_K8_LOOKBACK_DAYS", "180")
    os.environ.setdefault("PRED_K8_DISPLAY_OVERLAY", "1")
    os.environ.setdefault("REFRESH_K8_LIVE_FALLBACK", "1")
    if _live:
        print(
            "[Accuracy] Ricalcolo curve v4 + HistLib/seq (Yahoo, può richiedere diversi minuti)…",
            flush=True,
        )
    if not args.full_json_enrich:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "0")
        print(
            "[Accuracy] Enrich curve completo (ACCURACY_REFRESH_FAST=0). "
            "Solo metadata CT.gov leggero; per tutto il JSON: --full-json-enrich.",
            flush=True,
        )
    else:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "1")

    try:
        report = run_prediction_refresh(
            "accuracy",
            workbook_path=args.workbook,
            json_path=args.json,
            skip_nct_filter=args.skip_nct_relation_filter,
            live_sim_pred=_live,
            check_alignment=args.check_alignment,
            project_root=_ROOT,
        )
    except PermissionError:
        print(
            "\n[Accuracy] ERRORE: impossibile salvare il workbook — "
            "chiudi Excel su:\n"
            f"  {os.path.abspath(args.workbook)}\n"
            "e rilancia. Se esiste un file "
            "*__accuracy_staged_*.xlsx* in data\\, aprilo: il foglio Accuracy "
            "è già stato scritto lì.\n",
            file=sys.stderr,
            flush=True,
        )
        return 1
    print(
        f"[Accuracy] Record: pre-filtro={report.records_in} | "
        f"coorte={report.cohort_size} | filtro NCT: "
        f"{'OFF' if not report.nct_filter_applied else 'ON'}",
    )
    for w in report.warnings:
        print(f"[Accuracy] {w}", file=sys.stderr)
    if report.excel_written:
        _staged = next(
            (w for w in report.warnings if "accuracy_staged" in w.lower()),
            None,
        )
        if _staged:
            print(f"[Accuracy] Foglio «Accuracy» aggiornato (staged) — vedi warning sopra.")
        else:
            print(
                f"[Accuracy] Foglio «Accuracy» aggiornato → "
                f"{os.path.abspath(args.workbook)}"
            )
    return 0 if report.excel_written or not report.warnings else 1


if __name__ == "__main__":
    raise SystemExit(main())
