#!/usr/bin/env python3
"""Genera data/investment_decision_cohort.json per Investment Decision Lab (Fase A)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prediction.investment_decision_cohort import write_investment_decision_cohort
from orchestrator_io_paths import INVESTMENT_DECISION_COHORT_JSON


def main() -> int:
    ap = argparse.ArgumentParser(description="Build investment decision cohort JSON")
    ap.add_argument(
        "-o",
        "--output",
        default=INVESTMENT_DECISION_COHORT_JSON,
        help=f"Output path (default: {INVESTMENT_DECISION_COHORT_JSON})",
    )
    ap.add_argument(
        "--past-pred",
        default=None,
        help="Override past_catalyst_predictions.json path",
    )
    ap.add_argument(
        "--no-history",
        action="store_true",
        help="Non aggiornare investment_decision_cohort_history.json",
    )
    args = ap.parse_args()
    payload = write_investment_decision_cohort(
        path=args.output,
        past_pred_path=args.past_pred,
        record_history=not args.no_history,
    )
    s = payload.get("summary") or {}
    cmp_ = payload.get("comparison") or {}
    delta_ic = (cmp_.get("summary_delta") or {}).get("ic_spearman")
    default_hk = payload.get("default_horizon") or "pre4"
    by_h = (payload.get("summary_by_horizon") or {}).get(default_hk) or {}
    msg = (
        f"[Validazione modello] scritto {args.output} — "
        f"n={s.get('n_events', 0)} · "
        f"[wide] IC={s.get('ic_spearman')} hit={s.get('hit_rate_pct')}% · "
        f"[{default_hk}] IC={by_h.get('ic_spearman')} hit={by_h.get('hit_rate_pct')}% R={by_h.get('mean_r_hold_pp')}pp"
    )
    if delta_ic is not None:
        msg += f" · dIC_wide={delta_ic:+.4f}"
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
