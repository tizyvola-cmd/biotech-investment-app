#!/usr/bin/env python3
"""Wrapper: copia l'ultimo workbook __grafici_staged_* sul file principale."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

if __name__ == "__main__":
    try:
        runpy.run_path(
            str(_ROOT / "scripts" / "apply_grafici_staged.py"),
            run_name="__main__",
        )
    except SystemExit as exc:
        raise SystemExit(exc.code if exc.code is not None else 0) from None
