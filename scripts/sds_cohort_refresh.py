#!/usr/bin/env python3
"""
sds_cohort_refresh.py — Aggiornamento coorte SDS Supernova.

Modalità:
  --mode full  (default) — ricalcola tutti i ticker in finestra pre-CD (~120g) con FMP/dati freschi
  --mode light — Cluster C+E da prezzi/live; A/B/D da cache (nessuna chiamata FMP)
  --mode sync  — solo nuovi ticker entrati in finestra (dopo aggiornamento Simulation)

Pianificato dal web scheduler Lun–Ven alle 09:00 (``SUPERNOVA_SDS_REFRESH=1``).
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
    setup_logging,
    touch_lock,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="SDS Supernova cohort refresh")
    ap.add_argument(
        "--mode",
        choices=("full", "light", "sync"),
        default="full",
        help="full = ricalcolo coorte · light = C+E giornaliero · sync = solo nuovi entranti",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="esegui anche nel weekend")
    ap.add_argument("--no-fmp", action="store_true", help="sync senza fetch FMP (solo nuovi)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet, log_prefix="sds_cohort")
    today = dt.date.today()
    now = dt.datetime.now()

    logger.info("=" * 60)
    logger.info("SDS cohort refresh (%s) — %s", args.mode, now.isoformat(timespec="seconds"))

    if args.mode in ("full", "light"):
        ok, reason = is_market_day(today, force=args.force)
        if not ok:
            logger.info("SKIPPATO: %s", reason)
            return 0

    if args.dry_run:
        logger.info("DRY-RUN OK")
        return 0

    if not acquire_lock(logger, max_age_minutes=90):
        return 2

    _ = find_python()
    failures: list[str] = []

    def _on_ticker(idx: int, total: int, ticker: str) -> None:
        logger.info("SDS %s [%d/%d] %s", args.mode, idx, total, ticker)
        touch_lock(logger)

    try:
        from prediction.sds_data import (
            refresh_sds_cohort_full,
            refresh_sds_cohort_light,
            sync_sds_after_simulation,
        )

        use_fmp = not args.no_fmp
        if args.mode == "full":
            logger.info(
                "Avvio calcolo coorte (full%s) — ~1–3 min/ticker, attendere progresso…",
                "+FMP" if use_fmp else "",
            )
            result = refresh_sds_cohort_full(
                fetch_fmp=use_fmp,
                fetch_cluster_a=use_fmp,
                on_ticker=_on_ticker,
            )
            logger.info(
                "SDS full OK — n=%s fmp=%s at=%s",
                result.get("n"),
                result.get("fmp_fetched"),
                result.get("generated_at"),
            )
        elif args.mode == "light":
            logger.info("Avvio calcolo coorte (light) — prezzi/live + cache B/A/D…")
            result = refresh_sds_cohort_light(on_ticker=_on_ticker)
            logger.info(
                "SDS light OK — n=%s at=%s last_fmp=%s",
                result.get("n"),
                result.get("generated_at"),
                result.get("last_fmp_refresh_at"),
            )
        else:
            result = sync_sds_after_simulation(fetch_fmp=use_fmp, fetch_cluster_a=use_fmp)
            added = result.get("added_tickers") or []
            removed = result.get("removed_tickers") or []
            logger.info(
                "SDS sync OK — n=%s added=%s removed=%s",
                result.get("n"),
                added or "—",
                removed or "—",
            )

        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
        except Exception as exc:
            failures.append(f"manifest ({exc})")
    except Exception as exc:
        failures.append(str(exc))
        logger.exception("SDS refresh failed")
    finally:
        release_lock(logger)

    duration = (dt.datetime.now() - now).total_seconds() / 60
    if failures:
        logger.error("SDS refresh KO (%.1f min): %s", duration, ", ".join(failures))
        return 1
    logger.info("SDS refresh OK (%.1f min)", duration)
    return 0


if __name__ == "__main__":
    sys.exit(main())
