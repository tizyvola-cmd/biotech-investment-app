#!/usr/bin/env python3
"""
Rigenera il foglio Excel «Grafici» (curve e tabelle 2a–2c da «Simulation»).

Uso (NON usare ``python`` su file ``.bat``)::

    scripts\\Avvia_Grafici_Sheet.bat
    scripts\\Avvia_Grafici_Sheet.bat --refresh
    python scripts\\run_grafici_sheet.py
    .venv\\Scripts\\python.exe launch_grafici_sheet.py

Tempi tipici (--refresh): import moduli 10–45 s; apertura xlsx 30–120 s
(workbook grande); curve + Yahoo HistLib 1–10+ min se molti ticker obsoleti;
scrittura grafici 30–90 s. Non è bloccato se compaiono messaggi ``[Grafici]``.

``GRAFICI_FAST=1``: salta il refresh Yahoo (usa pickle HistLib in cache).

Chiudere il workbook in Excel prima del salvataggio.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    print("[Grafici] Avvio…", flush=True)
    if os.environ.get("GRAFICI_FAST", "").strip().lower() in ("1", "true", "yes"):
        print(
            "[Grafici] GRAFICI_FAST=1: nessun refresh Yahoo HistLib (cache locale).",
            flush=True,
        )
    print(
        "[Grafici] Caricamento moduli (data_orchestrator + pandas: "
        "di solito 10–45 s, poi apertura Excel)…",
        flush=True,
    )
    from orchestrator_io_paths import FINAL_XLSX
    from simulation_grafici_sheet import rebuild_grafici_sheet_only

    _args = [a for a in sys.argv[1:] if a.startswith("-")]
    _paths = [a for a in sys.argv[1:] if not a.startswith("-")]
    _path = Path(_paths[0]) if _paths else Path(FINAL_XLSX)
    _force = "--refresh" in _args or "--force" in _args
    print(f"[Grafici] Workbook: {_path}", flush=True)
    if _force:
        print("[Grafici] Modalità --refresh: ricalcolo curve da Simulation.", flush=True)
    print("[Grafici] Chiudi il file in Excel se è aperto.", flush=True)
    try:
        _out = rebuild_grafici_sheet_only(
            _path, save=True, force_refresh_source=_force
        )
    except PermissionError:
        print(
            "\n[ERRORE] Impossibile salvare — file aperto in Excel.\n"
            "Chiudi biotech_orchestrated_output.xlsx e riprova.\n",
            flush=True,
        )
        return 1
    except Exception as exc:
        print(f"\n[ERRORE] {exc}\n", flush=True)
        return 1
    print(f"\n[OK] Foglio «Grafici» scritto in:\n  {_out.resolve()}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
