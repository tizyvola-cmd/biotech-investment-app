#!/usr/bin/env python3
"""
Rigenera Simulation, Accuracy, Predizione — guida e Grafici
con storico calendario, seq_curve e fix HURA.

Uso:
  scripts\\Avvia_Refresh_Sim_Accuracy.bat
  .venv\\Scripts\\python.exe launch_refresh_sim_accuracy_grafici.py

Solo Grafici (Accuracy/guida già ok):
  .venv\\Scripts\\python.exe launch_refresh_sim_accuracy_grafici.py --skip-simulation --skip-guida --skip-accuracy

Chiudere il workbook Excel prima del salvataggio.
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from orchestrator_io_paths import FINAL_XLSX


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Rigenera fogli Simulation, Accuracy, Predizione — guida e Grafici "
            "nel workbook biotech."
        ),
    )
    p.add_argument(
        "workbook",
        nargs="?",
        default=FINAL_XLSX,
        help=f"Percorso workbook (default: {FINAL_XLSX})",
    )
    p.add_argument("--skip-simulation", action="store_true", help="Salta Simulation.")
    p.add_argument("--skip-accuracy", action="store_true", help="Salta Accuracy.")
    p.add_argument("--skip-guida", action="store_true", help="Salta Predizione — guida.")
    p.add_argument("--skip-grafici", action="store_true", help="Salta Grafici.")
    p.add_argument(
        "--no-live-sim-pred",
        action="store_true",
        help="Accuracy senza ricalcolo Yahoo (ACCURACY_REFRESH_FAST=1).",
    )
    p.add_argument(
        "--full-json-enrich",
        action="store_true",
        help="Enrich JSON completo anche con --no-live-sim-pred.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    try:
        from data_orchestrator import (
            regenerate_simulation_accuracy_grafici_sheets,
        )
    except ImportError:
        from refresh_sim_accuracy_grafici import (
            regenerate_simulation_accuracy_grafici_sheets,
        )

    if args.no_live_sim_pred and not args.full_json_enrich:
        os.environ.setdefault("ACCURACY_REFRESH_FAST", "1")

    print(f"[Refresh] Workbook: {args.workbook}")
    if args.skip_simulation:
        print("[Refresh] --skip-simulation: salta rigenerazione Simulation.")
    if args.skip_accuracy:
        print("[Refresh] --skip-accuracy: salta foglio Accuracy (solo Grafici).")
    if args.no_live_sim_pred:
        print(
            "[Refresh] --no-live-sim-pred: Accuracy senza ricalcolo Yahoo; "
            "enrich JSON leggero (ACCURACY_REFRESH_FAST=1). "
            "Per enrich completo: --full-json-enrich.",
        )
    if args.skip_guida:
        print("[Refresh] --skip-guida: salta Predizione — guida (μ ref Grafici).")
    if args.skip_grafici:
        print("[Refresh] --skip-grafici: Grafici non aggiornati.")
    if not args.skip_grafici and (
        args.skip_simulation and args.skip_guida and args.skip_accuracy
    ):
        print("[Refresh] Prossimo: solo Grafici (--refresh).", flush=True)

    try:
        ok = regenerate_simulation_accuracy_grafici_sheets(
            args.workbook,
            refresh_simulation=not args.skip_simulation,
            refresh_accuracy=not args.skip_accuracy,
            live_sim_pred=not args.no_live_sim_pred,
            refresh_grafici=not args.skip_grafici,
            refresh_guida=not args.skip_guida,
        )
    except PermissionError:
        print(
            "\n[ERRORE] Impossibile salvare — chiudi il file in Excel e riprova.\n",
            flush=True,
        )
        return 1
    except Exception as exc:
        print(f"\n[ERRORE] {exc}\n", flush=True)
        return 1

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
