#!/usr/bin/env python3
"""
hype_volume_funnel_scan.py — Daily volume-hype search (Lun–Ven ~07:00 IT).

Off-sheet names with share-volume ≥400% (24h VOL VS PREV) get a trusted
next-CD hook. Accepted names stay 10 days; after that only if the price
is rising or the ticker is an open portfolio position.

Called from ``scripts/morning_research_refresh.py``.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> int:
    ap = argparse.ArgumentParser(description="Daily volume-hype funnel scan")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    from hype_volume_funnel import run_hype_volume_funnel_scan

    result = run_hype_volume_funnel_scan()
    if not args.quiet:
        print(json.dumps(result, ensure_ascii=False, default=str))
    if result.get("error"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
