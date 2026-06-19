"""Stato job scan CD Simulation (CT.gov + rigenera foglio, ~2–8 min)."""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from orchestrator_io_paths import DATA_DIR, FINAL_XLSX

SIMULATION_CD_SCAN_STATUS_PATH = os.path.join(DATA_DIR, "simulation_cd_scan_status.json")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def write_simulation_cd_scan_status(**fields: Any) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    prev = read_simulation_cd_scan_status()
    merged: dict[str, Any] = {**prev, **fields, "updated_at": _now_iso()}
    with open(SIMULATION_CD_SCAN_STATUS_PATH, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False, indent=2)


def read_simulation_cd_scan_status() -> dict[str, Any]:
    if not os.path.isfile(SIMULATION_CD_SCAN_STATUS_PATH):
        return {}
    try:
        with open(SIMULATION_CD_SCAN_STATUS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def reset_simulation_cd_scan_running(*, message: str = "Avvio scan CD…") -> None:
    write_simulation_cd_scan_status(
        state="running",
        ok=None,
        step="starting",
        message=message,
        started_at=_now_iso(),
        finished_at=None,
        elapsed_sec=None,
        rows_before=None,
        rows_after=None,
        workbook=FINAL_XLSX,
        error=None,
    )
