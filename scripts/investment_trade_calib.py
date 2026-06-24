#!/usr/bin/env python3
"""Rigenera investment_trade_calib.json da posizioni Simulation (via sim-outcomes)."""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from prediction.investment_sim_outcomes import build_investment_sim_outcomes
from prediction.investment_trade_calib import write_investment_trade_calibration


def main() -> int:
    payload = build_investment_sim_outcomes()
    positions = payload.get("rows") or []
    calib = write_investment_trade_calibration(positions)
    print(
        f"[OK] trade_calib reliable={calib.get('calibration_reliable')} "
        f"n={calib.get('n_positions')}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
