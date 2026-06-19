#!/usr/bin/env python3
"""
morning_research_refresh.py — Aggiornamento mattutino ricerca (Lun–Ven, ~07:00 IT).

Esegue:
  1. ``new_bio_ipo.py`` — nuove IPO biotech → ``biotech_symbols.json`` + ``yf.json``
  2. ``launch_simulation_cd_scan.py`` — fetch CT.gov/FDA + rigenera Simulation + snapshot
  3. ``merge_yf_into_financial_snapshot`` — ticker IPO visibili subito in Financial
  4. bump ``desktop_data_manifest.json``

Pianificato dal web scheduler una volta al giorno feriale (default 07:00 Europe/Rome).
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.daily_market_refresh import (
    acquire_lock,
    find_python,
    is_market_day,
    release_lock,
    run_step,
    setup_logging,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Morning CD + IPO research refresh")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="esegui anche nel weekend")
    ap.add_argument("--skip-ipo", action="store_true")
    ap.add_argument("--skip-cd-scan", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet, log_prefix="morning_research")
    today = dt.date.today()
    now = dt.datetime.now()

    logger.info("=" * 60)
    logger.info("Morning research refresh — %s", now.isoformat(timespec="seconds"))

    ok, reason = is_market_day(today, force=args.force)
    if not ok:
        logger.info("SKIPPATO: %s", reason)
        return 0

    if args.dry_run:
        logger.info("DRY-RUN OK")
        return 0

    if not acquire_lock(logger, max_age_minutes=120):
        return 2

    py = find_python()
    failures: list[str] = []
    try:
        if not args.skip_ipo:
            rc = run_step(
                logger,
                name="new_bio_ipo",
                cmd=[py, "-u", "new_bio_ipo.py"],
                timeout_min=30,
            )
            if rc != 0:
                failures.append(f"new_bio_ipo (exit {rc})")

        if not args.skip_cd_scan:
            rc = run_step(
                logger,
                name="simulation_cd_scan",
                cmd=[py, "-u", "launch_simulation_cd_scan.py"],
                timeout_min=60,
            )
            if rc != 0:
                failures.append(f"cd_scan (exit {rc})")

        try:
            from excel_sheet_reader import merge_yf_into_financial_snapshot

            merge_result = merge_yf_into_financial_snapshot()
            logger.info("Financial merge IPO: %s", merge_result)
            if merge_result.get("error"):
                failures.append(f"merge_yf ({merge_result['error']})")
        except Exception as exc:
            failures.append(f"merge_yf ({exc})")

        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
            logger.info("Manifest bump OK")
        except Exception as exc:
            failures.append(f"manifest ({exc})")
    finally:
        release_lock(logger)

    duration = (dt.datetime.now() - now).total_seconds() / 60
    if failures:
        logger.error("Morning research KO (%.1f min): %s", duration, ", ".join(failures))
        return 1
    logger.info("Morning research OK (%.1f min)", duration)
    return 0


if __name__ == "__main__":
    sys.exit(main())
