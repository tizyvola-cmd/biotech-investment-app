"""Recompute regime multipliers + cluster cal_factors and show before/after.

End-to-end helper for applying the RISK_ON fix on real data:

  1. backfill ``regime_history.json`` from XBI/TLT/VIX prices (so historical
     outcomes get the regime that was actually in force, not today's);
  2. recompute regime multipliers and cluster cal_factors from the resolved
     outcome pool, using the fixed (guarded, least-squares) logic;
  3. print a before/after table.

By default it is a DRY RUN (nothing is written). Pass ``--apply`` to persist the
new ``regime_multipliers.json`` and ``cluster_cal_factors.json``.

Usage::

    python recalc_calibration.py              # dry-run: backfill + show before/after
    python recalc_calibration.py --apply      # also persist the recomputed values
    python recalc_calibration.py --no-backfill # skip the price backfill step
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from orchestrator_io_paths import CLUSTER_CAL_FACTORS_JSON, REGIME_MULTIPLIERS_JSON
from prediction.cluster_cal_factor import (
    collect_resolved_outcomes_from_sources,
    compute_cluster_cal_factors,
)
from prediction.regime_calibration import (
    compute_regime_multipliers,
    resolve_regime_outcomes_for_learning,
)


def _load(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _regime_table(before: dict, after: dict) -> str:
    b = (before.get("regimes") or {}) if isinstance(before, dict) else {}
    a = (after.get("regimes") or {}) if isinstance(after, dict) else {}
    rows = ["  regime      before   ->  after    status                 n     dir"]
    for r in ("RISK_ON", "NEUTRAL", "RISK_OFF"):
        bm = (b.get(r) or {}).get("multiplier")
        ae = a.get(r) or {}
        rows.append(
            f"  {r:<10}  {str(bm):>6}   ->  {str(ae.get('multiplier')):>6}    "
            f"{str(ae.get('status')):<22} {str(ae.get('n')):>4}  {str(ae.get('direction_acc'))}"
        )
    return "\n".join(rows)


def _cluster_table(before: dict, after: dict) -> str:
    b = (before.get("clusters") or {}) if isinstance(before, dict) else {}
    a = (after.get("clusters") or {}) if isinstance(after, dict) else {}
    rows = ["  cluster              before   ->  after    status                 n"]
    for name in sorted(a):
        ae = a.get(name) or {}
        if ae.get("cal_factor") is None:
            continue
        bm = (b.get(name) or {}).get("cal_factor")
        rows.append(
            f"  {name:<20} {str(bm):>6}   ->  {str(ae.get('cal_factor')):>6}    "
            f"{str(ae.get('status')):<22} {str(ae.get('n_samples')):>4}"
        )
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="persist recomputed values (default: dry-run)")
    parser.add_argument("--no-backfill", action="store_true", help="skip XBI/TLT/VIX regime backfill")
    parser.add_argument("--backfill-overwrite", action="store_true", help="rebuild already-recorded regime days")
    args = parser.parse_args(argv)

    if not args.no_backfill:
        print("== Step 1: backfill regime_history.json from prices ==")
        try:
            from prediction.backfill_regime_history import backfill

            summary = backfill(overwrite=args.backfill_overwrite)
            print(f"   {summary}")
        except Exception as exc:  # noqa: BLE001 - keep going if prices unavailable
            print(f"   SKIPPED (price fetch failed: {exc}). Recompute will use existing regime_history.json.")

    print("\n== Step 2: recompute (dry-run) ==")
    before_regime = _load(REGIME_MULTIPLIERS_JSON)
    before_cluster = _load(CLUSTER_CAL_FACTORS_JSON)

    outcomes = collect_resolved_outcomes_from_sources()
    regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
    after_regime = compute_regime_multipliers(regime_outcomes, dry_run=True)
    after_cluster = compute_cluster_cal_factors(outcomes, dry_run=True)

    print(f"   outcomes pool: {len(outcomes)} | regime-tagged pool: {len(regime_outcomes)}")
    print("\n-- Regime multipliers --")
    print(_regime_table(before_regime, after_regime))
    print("\n-- Cluster cal_factors --")
    print(_cluster_table(before_cluster, after_cluster))

    if args.apply:
        print("\n== Step 3: APPLY (persisting) ==")
        compute_regime_multipliers(regime_outcomes, dry_run=False)
        compute_cluster_cal_factors(outcomes, dry_run=False)
        print(f"   wrote {REGIME_MULTIPLIERS_JSON}")
        print(f"   wrote {CLUSTER_CAL_FACTORS_JSON}")
    else:
        print("\n(dry-run — nothing written. Re-run with --apply to persist.)")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
