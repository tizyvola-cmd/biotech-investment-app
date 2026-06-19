#!/usr/bin/env python3
"""
model_lab_accuracy_refresh.py — Aggiornamento dati RA Calibration + SDS Accuracy + EIS Magnitude (Lun–Ven 16:30).

Esegue:
  1. Quote Yahoo (prezzi freschi per curve Simulation)
  2. Snapshot Simulation + simulation_charts
  3. SDS cohort light (Cluster C+E da prezzi/live)
  4. Prezzi T+1/T+7 su eventi feed clinico + rebuild ``eis_magnitude_analysis.json``
  5. Report → ``data/model_lab_accuracy_refresh_report.json``
  6. bump ``desktop_data_manifest.json`` con ``ra_calibration_updated_at`` /
     ``sds_accuracy_updated_at`` / ``eis_magnitude_updated_at``

Pianificato dal web scheduler (``SUPERNOVA_MODEL_LAB_REFRESH=1``, default 16:30).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import uuid
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import DESKTOP_DATA_MANIFEST_JSON
from scripts.daily_market_refresh import (
    acquire_lock,
    find_python,
    is_market_day,
    release_lock,
    run_step,
    setup_logging,
)

REPORT_PATH = _ROOT / "data" / "model_lab_accuracy_refresh_report.json"


def _write_report(
    *,
    finished_at: str,
    stats: dict,
    error: str | None = None,
) -> dict:
    report = {
        "report_id": str(uuid.uuid4()),
        "run_type": "scheduled_model_lab_accuracy",
        "finished_at": finished_at,
        "change_count": 0,
        "stats": stats,
        "error": error,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def _patch_manifest(*, finished_at: str, report_id: str) -> None:
    from supernova_web_scheduler import bump_desktop_manifest

    bump_desktop_manifest()
    p = Path(DESKTOP_DATA_MANIFEST_JSON)
    if not p.is_file():
        return
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        doc = {}
    doc["ra_calibration_updated_at"] = finished_at
    doc["sds_accuracy_updated_at"] = finished_at
    doc["eis_magnitude_updated_at"] = finished_at
    doc["model_lab_accuracy_report_id"] = report_id
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _sync_signal_calibration_eis_magnitude(mag: dict) -> None:
    from prediction.signal_audit import SIGNAL_CALIB_PATH

    path = Path(SIGNAL_CALIB_PATH)
    if not path.is_file():
        return
    try:
        cal = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    cic = cal.get("curve_impact_cumulative")
    if not isinstance(cic, dict):
        cic = {}
    cic["eis_magnitude_analysis"] = mag
    cal["curve_impact_cumulative"] = cic
    path.write_text(json.dumps(cal, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Model Lab RA/SDS accuracy refresh")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="esegui anche nel weekend")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet, log_prefix="model_lab_accuracy")
    today = dt.date.today()
    started = dt.datetime.now(dt.timezone.utc)

    logger.info("=" * 60)
    logger.info("Model Lab accuracy refresh — %s", started.isoformat(timespec="seconds"))

    ok, reason = is_market_day(today, force=args.force)
    if not ok:
        logger.info("SKIPPATO: %s", reason)
        return 0

    if args.dry_run:
        logger.info("DRY-RUN OK — aggiornerebbe chart snapshot + SDS light + EIS magnitude + manifest")
        return 0

    if not acquire_lock(logger, max_age_minutes=45):
        return 2

    py = find_python()
    failures: list[str] = []
    stats: dict = {}

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

        logger.info("Step — export simulation + chart snapshots")
        try:
            from excel_sheet_reader import (
                export_simulation_charts_snapshot,
                export_simulation_snapshot,
            )

            sim = export_simulation_snapshot()
            stats["simulation_rows"] = len(sim.get("rows") or [])
            charts = export_simulation_charts_snapshot()
            stats["chart_series"] = len(charts.get("series") or {})
            if charts.get("generated_at"):
                stats["charts_generated_at"] = charts["generated_at"]
        except Exception as exc:
            failures.append(f"simulation_snapshots ({exc})")
            logger.exception("Simulation snapshot export failed")

        logger.info("Step — SDS cohort light")
        try:
            from prediction.sds_data import refresh_sds_cohort_light

            sds = refresh_sds_cohort_light()
            stats["sds_n"] = sds.get("n")
            stats["sds_generated_at"] = sds.get("generated_at")
        except Exception as exc:
            failures.append(f"sds_cohort_light ({exc})")
            logger.exception("SDS light refresh failed")

        logger.info("Step — EIS magnitude (clinical prices + calibration curve)")
        try:
            from clinical_pre_cd_enrichment import refresh_clinical_event_market_prices
            from prediction.eis_magnitude_analysis import (
                build_eis_magnitude_analysis,
                persist_eis_magnitude_analysis,
            )

            price_stats = refresh_clinical_event_market_prices(portfolio_only=True)
            stats["eis_price_records"] = price_stats.get("records_updated")
            stats["eis_events_d1"] = price_stats.get("events_with_price_1d")
            stats["eis_events_d7"] = price_stats.get("events_with_price_7d")
            mag = persist_eis_magnitude_analysis(build_eis_magnitude_analysis())
            stats["eis_n_scored"] = mag.get("n_events_scored")
            stats["eis_n_price_1d"] = mag.get("n_with_price_1d")
            stats["eis_n_price_7d"] = mag.get("n_with_price_7d")
            stats["eis_built_at"] = mag.get("built_at")
            _sync_signal_calibration_eis_magnitude(mag)
            logger.info(
                "EIS magnitude OK — scored=%s d1=%s d7=%s",
                mag.get("n_events_scored"),
                mag.get("n_with_price_1d"),
                mag.get("n_with_price_7d"),
            )
            from prediction.eis_super_score_learning import persist_eis_super_score_learning

            eis_super = persist_eis_super_score_learning(dry_run=False)
            stats["eis_super_changes"] = len(eis_super.get("changes") or [])
            stats["eis_super_mean_lift_7d"] = (eis_super.get("effectiveness") or {}).get("mean_lift_7d")
            from prediction.cd_pattern_polygon_accuracy import persist_cd_pattern_polygon_accuracy

            polygon = persist_cd_pattern_polygon_accuracy(dry_run=False)
            stats["polygon_accuracy_samples"] = polygon.get("n_samples")
        except Exception as exc:
            failures.append(f"eis_magnitude ({exc})")
            logger.exception("EIS magnitude refresh failed")

        finished_at = dt.datetime.now(dt.timezone.utc).isoformat()
        report = _write_report(
            finished_at=finished_at,
            stats=stats,
            error=", ".join(failures) if failures else None,
        )
        logger.info("Report written — id=%s", report.get("report_id"))

        try:
            _patch_manifest(
                finished_at=finished_at,
                report_id=str(report.get("report_id") or ""),
            )
            logger.info("Manifest patched — ra/sds/eis accuracy timestamps")
        except Exception as exc:
            failures.append(f"manifest ({exc})")
            logger.warning("Manifest patch failed: %s", exc)
    finally:
        release_lock(logger)

    duration = (dt.datetime.now(dt.timezone.utc) - started).total_seconds()
    if failures:
        logger.error("Model Lab accuracy KO (%.0fs): %s", duration, ", ".join(failures))
        return 1
    logger.info("Model Lab accuracy OK (%.0fs)", duration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
