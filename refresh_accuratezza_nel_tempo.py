#!/usr/bin/env python3
"""
Rigenera solo il foglio «📈 Accuratezza nel tempo» nel workbook Excel senza eseguire
tutto ``data_orchestrator``.

Legge lo storico ``data/model_accuracy_monitor_history.json`` (stesso del run completo)
e riscrive la tabella + grafico con ``write_accuracy_monitor_sheet``.

Non accoda righe: gli snapshot si aggiungono in ``save_final_outputs`` dopo ricalibrazione
automatica (intervallo ``CALIB_REFRESH_DAYS``, non legato al giorno 1 del mese), prima riga
se lo storico è vuoto, ``ACCURACY_MONITOR_EVERY_RUN=1``, oppure
``FORCE_ACCURACY_MONITOR_SNAPSHOT=1`` dopo modifiche al modello.

Se hai ``SKIP_ACCURACY_MONITOR=1`` nell’ambiente, questo script lo ignora temporaneamente
solo per poter riscrivere il foglio.

Uso:
  python refresh_accuratezza_nel_tempo.py
  python refresh_accuratezza_nel_tempo.py --workbook data/biotech_orchestrated_output.xlsx

PowerShell:
  Set-Location \"...\\Biotech_Investment app 6\"; python refresh_accuratezza_nel_tempo.py
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main() -> int:
    from openpyxl import load_workbook

    from orchestrator_io_paths import FINAL_XLSX
    from data_orchestrator import write_accuracy_monitor_sheet

    ap = argparse.ArgumentParser(
        description="Refresh foglio «📈 Accuratezza nel tempo» dal JSON storico."
    )
    ap.add_argument(
        "--workbook",
        default=FINAL_XLSX,
        help=f"Percorso .xlsx da aggiornare (default: {FINAL_XLSX})",
    )
    args = ap.parse_args()

    if not os.path.isfile(args.workbook):
        print(f"[AccMonitorRefresh] ERRORE: workbook non trovato: {args.workbook}", file=sys.stderr)
        return 1

    _skip_old = os.environ.get("SKIP_ACCURACY_MONITOR")
    if _skip_old:
        os.environ.pop("SKIP_ACCURACY_MONITOR", None)
        print(f"[AccMonitorRefresh] SKIP_ACCURACY_MONITOR era impostato ({_skip_old!r}) — ignorato per questo refresh.")

    try:
        wb = load_workbook(args.workbook, read_only=False, data_only=False)
        write_accuracy_monitor_sheet(wb)
        wb.save(args.workbook)
    finally:
        if _skip_old is not None:
            os.environ["SKIP_ACCURACY_MONITOR"] = _skip_old

    print(f"[AccMonitorRefresh] Foglio aggiornato → {os.path.abspath(args.workbook)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
