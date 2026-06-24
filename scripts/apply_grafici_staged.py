#!/usr/bin/env python3
"""Sostituisce data/biotech_orchestrated_output.xlsx con l'ultimo staged Grafici."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import FINAL_XLSX


def main() -> int:
    dst = Path(FINAL_XLSX)
    data_dir = dst.parent
    staged = sorted(data_dir.glob(f"{dst.stem}__grafici_staged_*{dst.suffix}"))
    if not staged:
        print("[Applica staged] Nessun file __grafici_staged_* in data/.", flush=True)
        print("  Esegui prima: scripts\\Avvia_Grafici_Sheet.bat --refresh", flush=True)
        return 1
    src = staged[-1]
    if not src.is_file():
        print(f"[Applica staged] File non trovato: {src}", flush=True)
        return 1
    try:
        shutil.copy2(src, dst)
    except PermissionError:
        print(
            "[Applica staged] File principale bloccato — chiudi Excel su:\n"
            f"  {dst.resolve()}",
            flush=True,
        )
        return 1
    print(f"[Applica staged] OK\n  da: {src.name}\n  a:  {dst.name}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
