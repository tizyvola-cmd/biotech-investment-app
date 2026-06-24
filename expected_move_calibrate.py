"""Build + preview the Expected Move Score (EMS) calibration.

EMS is a pre-event *magnitude* signal: it estimates how big the move around a
catalyst will be (for sizing / straddle screening). It does NOT predict
direction — that is structurally ~random for binary clinical readouts.

Usage::

    python expected_move_calibrate.py            # dry-run: build + show table
    python expected_move_calibrate.py --apply     # also persist calibration json
"""
from __future__ import annotations

import argparse

from prediction.expected_move_score import (
    EXPECTED_MOVE_CALIBRATION_JSON,
    build_expected_move_calibration,
)


def _table(cal: dict) -> str:
    if cal.get("status") != "active":
        return f"  status={cal.get('status')} n={cal.get('n_samples')}"
    rows = [
        f"  predictor: {cal['predictor']}  target: {cal['target']}  "
        f"corr={cal['overall_corr']}  n={cal['n_samples']}",
        "  bucket  label          n     pred<=    median|move|  mean|move|  P(>10pp)  straddle",
    ]
    for b in cal["buckets"]:
        rows.append(
            f"  Q{b['bucket']:<5} {b['label']:<12} {b['n']:>5} {str(b['pred_max']):>8}  "
            f"{b['median_move_pp']:>11}  {b['mean_move_pp']:>10}  {b['prob_gt_10pp']:>8}  "
            f"{'YES' if b['straddle_candidate'] else '-'}"
        )
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--apply", action="store_true", help="persist calibration (default: dry-run)")
    args = parser.parse_args(argv)

    cal = build_expected_move_calibration(dry_run=not args.apply)
    print("== Expected Move Score calibration ==")
    print(_table(cal))
    if args.apply:
        print(f"\n   wrote {EXPECTED_MOVE_CALIBRATION_JSON}")
    else:
        print("\n(dry-run — nothing written. Re-run with --apply to persist.)")
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
