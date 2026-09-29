#!/usr/bin/env python3
"""Refresh catalyst pattern library from SuperNova historical data."""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EIS_ROOT = ROOT / "eis_pattern_research"
sys.path.insert(0, str(EIS_ROOT))
sys.path.insert(0, str(ROOT))

from orchestrator_io_paths import DATA_DIR  # noqa: E402
from src.pattern_library import refresh_pattern_library  # noqa: E402

DEFAULT_LIBRARY = Path(DATA_DIR) / "catalyst_pattern_library.json"
DEFAULT_REPORT = Path(DATA_DIR) / "catalyst_pattern_audit.md"


def main() -> int:
    ap = argparse.ArgumentParser(description="Refresh catalyst pattern library")
    ap.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    ap.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    ap.add_argument("--no-mine", action="store_true", help="Skip auto-discovery of new patterns")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    doc = refresh_pattern_library(
        args.library,
        args.report,
        mine_new=not args.no_mine,
    )
    patterns = doc.get("patterns") or []
    confirmed = sum(1 for p in patterns if p.get("status") == "confirmed")
    emerging = sum(1 for p in patterns if p.get("status") == "emerging")
    print(f"Library updated: {args.library}")
    print(f"Report: {args.report}")
    print(f"Patterns: {len(patterns)} total ({confirmed} confirmed, {emerging} emerging)")
    cohort = doc.get("cohort_summary") or {}
    print(f"Cohort: {cohort.get('events')} events, {cohort.get('tickers')} tickers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
