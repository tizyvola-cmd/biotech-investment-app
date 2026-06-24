#!/usr/bin/env python3
"""Regenerate data/simulation_charts_snapshot.json from workbook + past_pred."""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from excel_sheet_reader import export_simulation_charts_snapshot


def main() -> int:
    export_simulation_charts_snapshot()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
