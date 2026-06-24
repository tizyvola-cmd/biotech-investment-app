"""Fast check of data_orchestrator.py without importing the module."""
from __future__ import annotations

import os
import re

_ROOT = os.path.dirname(os.path.abspath(__file__))
_ORCH = os.path.join(_ROOT, "data_orchestrator.py")

REQUIRED_FOR_REFRESH_FAST = (
    "regenerate_simulation_sheet_quick",
    "_run_simulation_sheet_into_workbook",
    "_write_accuracy_simulation_sheet",
    "merge_by_symbol",
    "_build_financial_df_for_orchestrator",
)


def orchestrator_preflight(*, refresh_simulation: bool = True) -> tuple[bool, str]:
    """
    Returns (ok, message). Does not import data_orchestrator (avoids 1–2 min hang).
    """
    if not os.path.isfile(_ORCH):
        return False, f"File non trovato: {_ORCH}"
    text = open(_ORCH, encoding="utf-8", errors="replace").read()
    n_lines = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
    need = list(REQUIRED_FOR_REFRESH_FAST) if refresh_simulation else [
        "_write_accuracy_simulation_sheet",
        "merge_by_symbol",
    ]
    missing = [n for n in need if not re.search(rf"^def {re.escape(n)}\b", text, re.M)]
    if missing:
        return (
            False,
            f"data_orchestrator.py troncato ({n_lines} righe, attese ~34000). "
            f"Mancano: {', '.join(missing)}. "
            "Ripristina il file (OneDrive → Cronologia versioni su data_orchestrator.py) "
            "poi: py -3 scripts\\check_orchestrator_health.py",
        )
    return True, f"OK ({n_lines} righe, funzioni refresh presenti)."
