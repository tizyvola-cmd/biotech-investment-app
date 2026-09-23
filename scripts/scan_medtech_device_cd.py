#!/usr/bin/env python3
"""
Scan CT.gov for INDUSTRY device studies with primary/completion date within N days.
Matches lead sponsor to medtech + yf + SEC ticker maps.

Usage:
  py -3 scripts/scan_medtech_device_cd.py
  py -3 scripts/scan_medtech_device_cd.py --days 120 --pages 15
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from medtech_universe import (  # noqa: E402
    discover_ctgov_device_tickers,
    load_json_list,
    MEDTECH_SYMBOLS_JSON,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=120, help="CD horizon (default 120)")
    ap.add_argument("--pages", type=int, default=12, help="Max CT.gov pages")
    ap.add_argument("--json", action="store_true", help="Print JSON")
    args = ap.parse_args()

    medtech_set = set(load_json_list(MEDTECH_SYMBOLS_JSON))
    tickers, rows = discover_ctgov_device_tickers(
        horizon_days=args.days,
        max_pages=args.pages,
        medtech_only=False,
    )

    in_universe = [r for r in rows if r.get("ticker") in medtech_set]
    print(f"\n=== MedTech device studies - CD <= {args.days}d - INDUSTRY sponsor ===")
    print(f"Total mapped: {len(rows)} · in medtech_symbols ({len(medtech_set)}): {len(in_universe)}")

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0

    print("\n--- In medtech_symbols.json ---")
    for r in in_universe[:30]:
        print(
            f"  T-{r['days_to_cd']:3d}d {r['completion_date']} {r['ticker']:6} {r['nct_id']} "
            f"| {r['lead_sponsor'][:50]}"
        )
        print(f"         {r['brief_title'][:85]}")

    outside = [r for r in rows if r.get("ticker") not in medtech_set]
    if outside:
        print(f"\n--- Mapped but not yet in medtech_symbols ({len(outside)}) ---")
        for r in outside[:15]:
            print(
                f"  T-{r['days_to_cd']:3d}d {r['ticker']:6} {r['nct_id']} | {r['lead_sponsor'][:55]}"
            )

    if tickers:
        print(f"\nDiscovered tickers: {', '.join(tickers)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
