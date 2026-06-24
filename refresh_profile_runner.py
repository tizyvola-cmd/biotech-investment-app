"""
Avvio profili refresh (condiviso tra SuperNova API, Refresh Desktop Tk, UI Electron).
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, FINAL_XLSX, LAST_ORCH_LOG, project_root

ROOT = Path(project_root())

# Import lazy da refresh_desktop_app per non duplicare PROFILES / env
_PROFILE_ALIASES = {
    "": "daily",
    "daily": "daily",
    "accuracy_only": "accuracy",
    "simulation_only": "simulation",
    "accuracy": "accuracy",
    "simulation": "simulation",
    "sec_k8": "sec_k8",
    "sunday": "sunday",
    "dry_run": "dry_run",
}


def normalize_refresh_profile(profile: str) -> str:
    return _PROFILE_ALIASES.get((profile or "daily").strip().lower(), "")


def list_refresh_profiles() -> list[dict[str, str]]:
    from refresh_desktop_app import PROFILES

    out: list[dict[str, str]] = []
    for key, prof in PROFILES.items():
        out.append(
            {
                "id": key,
                "title": prof.title,
                "detail": prof.detail,
                "eta": prof.eta,
            }
        )
    return out


def refresh_log_path(profile_key: str) -> Path:
    if profile_key == "sunday":
        return Path(LAST_ORCH_LOG)
    return Path(DATA_DIR) / "last_refresh_desktop.log"


def build_refresh_command(profile_key: str, python_exe: str) -> tuple[list[str], dict[str, str], Path]:
    """
    Restituisce (argv, env_patch, log_path).
    ``argv[0]`` è l'eseguibile (python o powershell).
    """
    from refresh_desktop_app import PROFILES

    key = normalize_refresh_profile(profile_key)
    if not key or key not in PROFILES:
        raise ValueError(f"Profilo refresh sconosciuto: {profile_key}")

    prof = PROFILES[key]
    log_path = refresh_log_path(key)

    if key == "sunday":
        ps1 = ROOT / "scripts" / "Biotech_Refresh_Profiles.ps1"
        if not ps1.is_file():
            raise FileNotFoundError(f"Script non trovato: {ps1}")
        argv = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ps1),
            "-Profile",
            "WeeklyFull",
        ]
        return argv, dict(prof.env_patch), log_path

    argv = [python_exe, *prof.argv]
    return argv, dict(prof.env_patch), log_path


def workbook_status() -> dict[str, Any]:
    from refresh_desktop_app import _is_workbook_locked, _read_status_file
    from refresh_fast_status import find_latest_staged_workbook

    wb = Path(FINAL_XLSX)
    staged = find_latest_staged_workbook(str(wb))
    st = _read_status_file()
    orch_summary = None
    try:
        from orchestrator_run_summary import load_last_summary

        orch_summary = load_last_summary()
    except Exception:
        pass
    return {
        "workbook": wb.name,
        "workbook_path": str(wb),
        "workbook_locked": _is_workbook_locked(wb),
        "staged_path": staged,
        "staged_name": Path(staged).name if staged else None,
        "refresh_fast_status": st,
        "orchestrator_summary": orch_summary,
    }
