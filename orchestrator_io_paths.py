"""
Canonical filesystem paths for SuperNova / data_orchestrator.

Shared by ``supernova_api``, ``data_orchestrator``, and CLI entry points.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def project_root() -> Path:
    """Repository root (directory containing this module)."""
    return Path(__file__).resolve().parent


_ROOT = project_root()
_DATA = _ROOT / "data"

DATA_DIR = str(_DATA)
FINAL_XLSX = str(_DATA / "biotech_investment_master.xlsx")
FINAL_JSON = str(_DATA / "final.json")
PAST_CATALYST_PREDICTIONS_JSON = str(_DATA / "past_catalyst_predictions.json")
LAST_ORCH_LOG = str(_DATA / "last_orchestrator.log")

ORCHESTRATOR_SCRIPT = str(_ROOT / "data_orchestrator.py")

if sys.platform == "win32":
    _venv_py = _ROOT / ".venv" / "Scripts" / "python.exe"
else:
    _venv_py = _ROOT / ".venv" / "bin" / "python"

PYTHON_VENV_EXE = str(_venv_py if _venv_py.is_file() else Path(sys.executable))
