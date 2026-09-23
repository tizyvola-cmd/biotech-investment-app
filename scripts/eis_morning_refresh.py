#!/usr/bin/env python3
"""
eis_morning_refresh.py — Aggiornamento EIS / feed clinico (Lun–Ven, 10:00 Europe/Rome).

Esegue:
  1. Arricchimento feed pre-CD (``clinical_pre_cd_enrichment``) con AI
     — scope: tutti i ticker in Simulation (+ posizioni portfolio).
  2. Rebuild ``signal_calibration.json`` (include ``eis_cohort_comparison`` per Performance tab).
  3. Report diff → ``data/clinical_feed_refresh_report.json`` (popup UI).
  4. bump ``desktop_data_manifest.json``

Pianificato dal web scheduler (``SUPERNOVA_EIS_REFRESH=1``, default 10:00).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from scripts.daily_market_refresh import (
    acquire_lock,
    is_market_day,
    release_lock,
    setup_logging,
)


def _configure_ai_for_eis() -> None:
    """Claude first; fallback Copilot when Anthropic fails (quota/credits)."""
    os.environ.setdefault("AI_PROVIDER", "anthropic")
    os.environ.setdefault("AI_ALLOW_FALLBACK", "1")


def _load_prev_records() -> list[dict]:
    from clinical_pre_cd_enrichment import load_snapshot

    snap = load_snapshot()
    return list(snap.get("records") or [])


def main() -> int:
    ap = argparse.ArgumentParser(description="Morning EIS / clinical feed refresh")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="esegui anche nel weekend")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--portfolio-only", action="store_true", default=True)
    ap.add_argument("--all-tickers", action="store_true", help="arricchisci tutti i ticker (non solo portfolio)")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet, log_prefix="eis_morning")
    today = dt.date.today()
    now = dt.datetime.now()

    logger.info("=" * 60)
    logger.info("EIS morning refresh — %s", now.isoformat(timespec="seconds"))

    ok, reason = is_market_day(today, force=args.force)
    if not ok:
        logger.info("SKIPPATO: %s", reason)
        return 0

    if args.dry_run:
        logger.info("DRY-RUN OK — arricchirebbe feed clinico + signal_calibration")
        return 0

    if not acquire_lock(logger, max_age_minutes=180):
        return 2

    _configure_ai_for_eis()
    prev_records = _load_prev_records()
    portfolio_only = not args.all_tickers

    try:
        import ai_provider
        from clinical_feed_refresh_report import (
            diff_clinical_feed_records,
            write_refresh_report,
        )
        from clinical_pre_cd_enrichment import load_snapshot, run_clinical_pre_cd_refresh

        logger.info("Step 1 — clinical pre-CD enrichment (scope=Simulation+portfolio)")
        enrich = run_clinical_pre_cd_refresh(
            portfolio_only=portfolio_only,
            force=False,
            deep=False,
        )
        enrich_error = enrich.get("error")
        # "no work items" is not a real failure: it means the portfolio's tickers have no
        # matching clinical trials in the current snapshot (either because the trials are
        # closed/withdrawn, or because those tickers aren't tracked in the Simulation sheet).
        # We still want the popup to render "no changes today" rather than "update failed".
        soft_no_data = enrich_error == "no work items"
        if enrich_error and not soft_no_data:
            logger.error("Enrichment error: %s", enrich_error)
            tb = enrich.get("traceback")
            if tb:
                logger.error("Enrichment traceback:\n%s", tb)
            write_refresh_report(
                run_type="scheduled_morning_eis",
                stats={"enrich": {k: enrich.get(k) for k in ("error", "count", "ai_ok") if k in enrich}},
                changes=[],
                ai_provider=ai_provider.provider_info(),
                error=str(enrich_error),
            )
            return 1

        if soft_no_data:
            logger.info(
                "Enrichment produced no work items — treating as soft success (0 studies match portfolio filter)."
            )

        logger.info("Step 1b — verifica ipotesi in attesa (finestra aperta)")
        verify_stats: dict | None = None
        try:
            from prediction.eis_hypothesis_verifier import verify_pending_hypotheses

            verify_stats = verify_pending_hypotheses()
            logger.info(
                "Verifica ipotesi — %s controllate, %s confermate, %s scadute",
                verify_stats.get("checked"),
                verify_stats.get("confirmed"),
                verify_stats.get("expired"),
            )
        except Exception as exc:
            logger.warning("Verifica ipotesi fallita (non-fatal): %s", exc)

        new_records = list(load_snapshot().get("records") or [])
        changes = diff_clinical_feed_records(prev_records, new_records)
        logger.info(
            "Enrichment OK — %s studi, %s AI ok, %s change(s) for popup",
            enrich.get("count", 0),
            enrich.get("ai_ok", 0),
            len(changes),
        )

        cal_ok = False
        cal_err: str | None = None
        logger.info("Step 2 — rebuild signal_calibration.json (EIS cohort)")
        try:
            from prediction.signal_audit import build_calibration_document

            doc = build_calibration_document(close_outcomes_first=False)
            cal_ok = True
            try:
                from prediction.eis_cohort_weekly_history import append_weekly_snapshot

                row = append_weekly_snapshot(doc.get("eis_cohort_comparison"))
                if row:
                    logger.info(
                        "EIS weekly trend snapshot — week=%s with_n=%s without_n=%s",
                        row.get("week_key"),
                        row.get("with_eis_n"),
                        row.get("without_eis_n"),
                    )
            except Exception as snap_exc:
                logger.warning("EIS weekly history snapshot failed (non-fatal): %s", snap_exc)
        except Exception as exc:
            cal_err = str(exc)
            logger.warning("Signal calibration rebuild failed: %s", exc)

        provider_info = ai_provider.provider_info()
        stats = {
            "enrich": enrich,
            "hypothesis_verification": verify_stats,
            "signal_calibration_rebuilt": cal_ok,
            "signal_calibration_error": cal_err,
            "ai_primary": os.environ.get("AI_PROVIDER", "anthropic"),
            "ai_active": provider_info.get("active"),
            "ai_label": provider_info.get("label"),
        }
        report = write_refresh_report(
            run_type="scheduled_morning_eis",
            stats=stats,
            changes=changes,
            ai_provider=provider_info,
            error=cal_err if not cal_ok and cal_err else None,
        )
        logger.info("Report written — change_count=%s", report.get("change_count"))

        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
            manifest_path = _ROOT / "data" / "desktop_data_manifest.json"
            if manifest_path.is_file():
                doc = json.loads(manifest_path.read_text(encoding="utf-8"))
                doc["clinical_feed_updated_at"] = report.get("finished_at")
                doc["clinical_feed_report_id"] = report.get("report_id")
                manifest_path.write_text(
                    json.dumps(doc, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
        except Exception as exc:
            logger.warning("Manifest bump failed: %s", exc)

        if cal_err and not cal_ok:
            return 1
        return 0
    finally:
        release_lock(logger)


if __name__ == "__main__":
    raise SystemExit(main())
