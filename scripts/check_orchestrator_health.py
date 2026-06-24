#!/usr/bin/env python3
"""Verifica che data_orchestrator.py contenga le funzioni richieste da refresh_fast."""
from __future__ import annotations

import os
import re
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ORCH = os.path.join(_ROOT, "data_orchestrator.py")

REQUIRED = (
    "regenerate_simulation_sheet_quick",
    "_run_simulation_sheet_into_workbook",
    "_write_accuracy_simulation_sheet",
    "merge_by_symbol",
    "_build_financial_df_for_orchestrator",
    "_orch_commit_xlsx_replace_or_stage",
    "_write_full_sim_sheet",
)


def main() -> int:
    if not os.path.isfile(_ORCH):
        print(f"File non trovato: {_ORCH}")
        return 2
    text = open(_ORCH, encoding="utf-8", errors="replace").read()
    n_lines = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
    missing = []
    present = []
    for name in REQUIRED:
        if re.search(rf"^def {re.escape(name)}\b", text, re.M):
            present.append(name)
        else:
            missing.append(name)
    print(f"data_orchestrator.py: {n_lines} righe")
    print(f"OK ({len(present)}): {', '.join(present) or '(nessuna)'}")
    if missing:
        print(f"MANCANTI ({len(missing)}): {', '.join(missing)}")
        print()
        print(
            "Il file è probabilmente TRONCATO (atteso ~34k righe). "
            "Ripristina la versione completa prima di refresh_fast o macro Excel."
        )
        print("Vedi: scripts\\RESTORE_DATA_ORCHESTRATOR.md")
        return 1
    print("Tutte le funzioni richieste sono presenti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
