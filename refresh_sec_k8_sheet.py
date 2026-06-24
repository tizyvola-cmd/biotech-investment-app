#!/usr/bin/env python3
"""
Rigenera **solo** il foglio «SEC K-8» nel workbook Excel senza eseguire l’intero orchestrator.

Chiama ``regenerate_sec_k8_sheet_quick`` (merge + **stessa coorte merge Accuracy** + filtro
Exact/Partial e relazione CT **≠ N/D** + fetch SEC).

Uso (da questa cartella del progetto):

  python refresh_sec_k8_sheet.py
  python refresh_sec_k8_sheet.py --workbook data/biotech_orchestrated_output.xlsx

PowerShell: non basta digitare ``refresh_sec_k8_sheet.py`` (non è nel PATH e la cwd non
si usa da sola). Usa sempre ``python`` + percorso esplicito:

  cd \"...\\Biotech_Investment app 6\"
  python .\\refresh_sec_k8_sheet.py

Chiudi il file in Excel prima di salvare. Imposta ``SEC_EDGAR_USER_AGENT`` (policy SEC Fair Access).
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main() -> int:
    from orchestrator_io_paths import FINAL_XLSX
    from data_orchestrator import regenerate_sec_k8_sheet_quick

    ap = argparse.ArgumentParser(
        description="Aggiorna solo il foglio «SEC K-8» (Form 8-K, finestra vs CD).",
    )
    ap.add_argument(
        "--workbook",
        default=FINAL_XLSX,
        help=f"Percorso .xlsx da aggiornare (default: {FINAL_XLSX})",
    )
    args = ap.parse_args()

    if not os.path.isfile(args.workbook):
        print(f"[SEC K-8 refresh] ERRORE: workbook non trovato: {args.workbook}", file=sys.stderr)
        return 1

    ok = regenerate_sec_k8_sheet_quick(args.workbook)
    if ok:
        print(f"[SEC K-8 refresh] Completato → {os.path.abspath(args.workbook)}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
