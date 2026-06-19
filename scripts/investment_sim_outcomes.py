#!/usr/bin/env python3
"""Genera data/investment_sim_outcomes.json — analisi esiti simulazioni investimento."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import INVESTMENT_SIM_OUTCOMES_JSON, SIMULATION_SHEET_SNAPSHOT_JSON
from prediction.investment_sim_outcomes import write_investment_sim_outcomes


def main() -> int:
    ap = argparse.ArgumentParser(description="Build investment sim outcomes JSON")
    ap.add_argument("-o", "--output", default=INVESTMENT_SIM_OUTCOMES_JSON)
    ap.add_argument("--simulation", default=None, help="Override simulation_sheet_snapshot.json")
    args = ap.parse_args()
    payload = write_investment_sim_outcomes(
        path=args.output,
        simulation_path=args.simulation or SIMULATION_SHEET_SNAPSHOT_JSON,
    )
    s = payload.get("summary") or {}
    err = payload.get("error")
    if err:
        print(f"[Sim outcomes] ERRORE: {err}")
        return 1
    print(
        f"[Sim outcomes] scritto {args.output} — "
        f"posizioni={s.get('n_positions', 0)} · win={s.get('win_rate_pct')}% · "
        f"P&L tot={s.get('total_pnl_eur')} · hit pred={s.get('hit_pred_direction_pct')}%"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
