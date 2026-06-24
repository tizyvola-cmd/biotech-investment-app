#!/usr/bin/env python3
"""
hourly_financial_refresh.py — Refresh leggero prezzi Finance (Lun–Ven, finestra oraria IT).

Esegue:
  1. ``fetch_yfinance.py`` — aggiorna quote Yahoo (cache incrementale)
  2. ``sync_yf_quotes_into_financial_snapshot`` — propaga prezzi al JSON Financial
  3. ``refresh_live_signals.py`` — slope/pred5 ticker vicini al CD (~30 s)
  4. ``post_refresh_steps`` (leggero) — SDS light + market context gate
  5. bump ``desktop_data_manifest.json`` (reload UI remota)

Pianificato dal web scheduler alle 15:30, 16:30, … 21:30 (Europe/Rome).
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
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
    ap = argparse.ArgumentParser(description="Hourly financial refresh (quote + live signals)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="esegui anche nel weekend")
    ap.add_argument("--cd-horizon", type=int, default=60)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet, log_prefix="hourly_financial")
    today = dt.date.today()
    now = dt.datetime.now()

    logger.info("=" * 60)
    logger.info("Hourly financial refresh — %s", now.isoformat(timespec="seconds"))

    ok, reason = is_market_day(today, force=args.force)
    if not ok:
        logger.info("SKIPPATO: %s", reason)
        return 0

    if args.dry_run:
        logger.info("DRY-RUN OK")
        return 0

    if not acquire_lock(logger, max_age_minutes=45):
        return 2

    py = find_python()
    failures: list[str] = []
    try:
        rc = run_step(
            logger,
            name="fetch_yfinance_quotes",
            cmd=[py, "-u", "fetch_yfinance.py"],
            timeout_min=25,
            extra_env={
                "YF_QUOTE_REFRESH_HOURS": "0.5",
                "YF_CACHE_STICKY": "1",
            },
        )
        if rc != 0:
            failures.append(f"fetch_yfinance (exit {rc})")

        try:
            from excel_sheet_reader import sync_yf_quotes_into_financial_snapshot

            sync_result = sync_yf_quotes_into_financial_snapshot()
            logger.info("Financial snapshot sync: %s", sync_result)
            if sync_result.get("error"):
                failures.append(f"sync_yf_quotes ({sync_result['error']})")
        except Exception as exc:
            failures.append(f"sync_yf_quotes ({exc})")

        rc = run_step(
            logger,
            name="refresh_live_signals",
            cmd=[py, "-u", "refresh_live_signals.py", "--cd-horizon", str(args.cd_horizon)],
            timeout_min=15,
        )
        if rc != 0:
            failures.append(f"refresh_live_signals (exit {rc})")

        # SDS light + market context (same tail as daily post-refresh, without heavy cohort/calib).
        try:
            from post_refresh_steps import run_post_refresh_steps

            post_failures = run_post_refresh_steps(
                skip_dircalib=True,
                skip_cohort=True,
                skip_live_signals=True,
                skip_sds_light=False,
                cd_horizon=args.cd_horizon,
                timeout_live_min=15,
                logger=logger,
            )
            failures.extend(post_failures)
        except Exception as exc:
            failures.append(f"post_refresh_steps ({exc})")

        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
            logger.info("Manifest bump OK")
        except Exception as exc:
            failures.append(f"manifest ({exc})")
    finally:
        release_lock(logger)

    duration = (dt.datetime.now() - now).total_seconds()
    if failures:
        logger.error("Hourly financial KO (%.0fs): %s", duration, ", ".join(failures))
        return 1
    logger.info("Hourly financial OK (%.0fs)", duration)
    return 0


if __name__ == "__main__":
    sys.exit(main())
