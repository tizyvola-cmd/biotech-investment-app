#!/usr/bin/env python3
"""Esegui con: python scripts/run_grafici_sheet.py  (NON usare python sul file .bat)"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

runpy.run_path(str(_ROOT / "launch_grafici_sheet.py"), run_name="__main__")
