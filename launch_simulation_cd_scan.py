#!/usr/bin/env python3
"""
Scan CD Simulation (~2–8 min):
  1. Fetch clinico incrementale (CT.gov / OpenFDA, cache 14 gg)
  2. Rigenera foglio Simulation (CD entro SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS, default 120 gg)
  3. Esporta snapshot JSON desktop

Uso:
  py -3 launch_simulation_cd_scan.py

Equivalente API: POST /api/simulation/cd-scan/run
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

_ROOT = os.path.dirname(os.path.abspath(__file__))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from orchestrator_io_paths import FINAL_XLSX
from simulation_cd_scan_status import (
    read_simulation_cd_scan_status,
    write_simulation_cd_scan_status,
)


def _sim_row_count() -> int:
    try:
        from excel_sheet_reader import read_sheet_table

        tbl = read_sheet_table("Simulation", xlsx_path=FINAL_XLSX)
        rows = tbl.get("rows") or []
        return len([r for r in rows if str(r.get("Ticker") or "").strip()])
    except Exception:
        return 0


def _run_script(name: str, script: str, *, timeout_min: int = 45) -> int:
    py = sys.executable
    cmd = [py, "-u", script]
    print(f"[CD scan] Step {name}: {' '.join(cmd)}", flush=True)
    write_simulation_cd_scan_status(step=name, message=f"In corso: {name}…")
    try:
        proc = subprocess.run(
            cmd,
            cwd=_ROOT,
            timeout=max(60, timeout_min * 60),
            check=False,
        )
        return int(proc.returncode or 0)
    except subprocess.TimeoutExpired:
        print(f"[CD scan] Timeout step {name}", flush=True)
        return 124


def main() -> int:
    t0 = time.time()
    started = read_simulation_cd_scan_status().get("started_at")
    rows_before = _sim_row_count()
    write_simulation_cd_scan_status(
        state="running",
        ok=None,
        step="clinical",
        message="Fetch clinico incrementale (CT.gov)…",
        rows_before=rows_before,
        rows_after=None,
        workbook=FINAL_XLSX,
        error=None,
        started_at=started or None,
    )

    rc_clinical = _run_script("clinical", "BiotechClinicalTrialDataFetcher.py", timeout_min=30)
    if rc_clinical != 0:
        msg = f"Fetch clinico terminato con errori (exit {rc_clinical})."
        write_simulation_cd_scan_status(
            state="error",
            ok=False,
            step="clinical",
            message=msg,
            error=msg,
            elapsed_sec=round(time.time() - t0, 1),
            finished_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        return rc_clinical

    write_simulation_cd_scan_status(
        step="simulation",
        message="Rigenerazione foglio Simulation (CD ≤ 120 gg)…",
    )
    try:
        from data_orchestrator import regenerate_simulation_sheet_quick

        ok_sim = regenerate_simulation_sheet_quick(FINAL_XLSX)
    except Exception as exc:
        msg = f"Rigenerazione Simulation fallita: {exc}"
        print(f"[CD scan] {msg}", flush=True)
        write_simulation_cd_scan_status(
            state="error",
            ok=False,
            step="simulation",
            message=msg,
            error=str(exc),
            elapsed_sec=round(time.time() - t0, 1),
            finished_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        return 1

    if not ok_sim:
        msg = "Rigenerazione Simulation non riuscita (workbook bloccato o dati mancanti)."
        write_simulation_cd_scan_status(
            state="error",
            ok=False,
            step="simulation",
            message=msg,
            error=msg,
            elapsed_sec=round(time.time() - t0, 1),
            finished_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        )
        return 1

    rows_after = _sim_row_count()
    write_simulation_cd_scan_status(
        step="export",
        message="Esportazione snapshot desktop…",
        rows_after=rows_after,
    )
    export_err = None
    try:
        from excel_sheet_reader import export_desktop_snapshots

        export_desktop_snapshots(xlsx_path=FINAL_XLSX)
    except Exception as exc:
        export_err = str(exc)
        print(f"[CD scan] export_desktop_snapshots: {exc}", flush=True)

    elapsed = round(time.time() - t0, 1)
    delta = rows_after - rows_before
    if delta > 0:
        summary = (
            f"Scan completato in {elapsed:.0f}s · Simulation: {rows_before}→{rows_after} righe "
            f"(+{delta} nuove entro finestra CD)."
        )
    elif delta < 0:
        summary = (
            f"Scan completato in {elapsed:.0f}s · Simulation: {rows_before}→{rows_after} righe "
            f"({delta} uscite dalla finestra)."
        )
    else:
        summary = (
            f"Scan completato in {elapsed:.0f}s · Simulation: {rows_after} righe "
            "(nessuna nuova riga; dati clinici aggiornati)."
        )
    if export_err:
        summary += f" Export snapshot: {export_err}"

    write_simulation_cd_scan_status(
        state="ok" if not export_err else "error",
        ok=export_err is None,
        step="done",
        message=summary,
        rows_before=rows_before,
        rows_after=rows_after,
        elapsed_sec=elapsed,
        finished_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        error=export_err,
    )
    print(f"[CD scan] {summary}", flush=True)
    return 0 if export_err is None else 1


if __name__ == "__main__":
    sys.exit(main())
