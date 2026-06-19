"""Compat: l’app desk è ``supernova_dpg.py``; Tk legacy: ``supernova_desk_tk_legacy.py``."""
from __future__ import annotations

import runpy
from pathlib import Path

if __name__ == "__main__":
    _desk = Path(__file__).resolve().parent.parent / "supernova_dpg.py"
    runpy.run_path(str(_desk), run_name="__main__")
