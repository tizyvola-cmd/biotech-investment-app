#!/usr/bin/env python3
"""
Post-refresh steps condivisi tra scheduler giornaliero e orchestrator settimanale:

  1. scripts/_build_directional_calibration.py
  2. scripts/investment_decision_cohort.py
  3. refresh_live_signals.py
  4. SDS light refresh (Cluster C+E da prezzi/live; A/B/D da cache)

Usato da ``scripts/daily_market_refresh.py`` e dopo ``data_orchestrator`` (WeeklyFull).
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _find_python() -> str:
    venv = ROOT / ".venv" / "Scripts" / "python.exe"
    if venv.is_file():
        return str(venv)
    return sys.executable or "python"


def run_post_refresh_steps(
    *,
    skip_dircalib: bool = False,
    skip_cohort: bool = False,
    skip_live_signals: bool = False,
    skip_sds_light: bool = False,
    cd_horizon: int | None = None,
    timeout_dircalib_min: int = 5,
    timeout_cohort_min: int = 10,
    timeout_live_min: int = 15,
    logger: logging.Logger | None = None,
) -> list[str]:
    """
    Esegue gli step post-refresh. Restituisce lista nomi step falliti.
    """
    log = logger or logging.getLogger("post_refresh_steps")
    py = _find_python()
    failures: list[str] = []

    if cd_horizon is None:
        try:
            cd_horizon = int(os.environ.get("LIVE_SIGNALS_CD_HORIZON", "60"))
        except ValueError:
            cd_horizon = 60

    def _run(name: str, cmd: list[str], timeout_min: int) -> None:
        log.info("─" * 50)
        log.info("POST-STEP: %s", name)
        log.info("CMD: %s", " ".join(cmd))
        t0 = time.time()
        env = os.environ.copy()
        env.setdefault("PYTHONUNBUFFERED", "1")
        env.setdefault("PYTHONIOENCODING", "utf-8")
        try:
            cp = subprocess.run(
                cmd,
                cwd=str(ROOT),
                env=env,
                timeout=max(1, timeout_min) * 60,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired:
            log.error("%s: TIMEOUT dopo %d min", name, timeout_min)
            failures.append(f"{name} (timeout)")
            return
        except OSError as exc:
            log.error("%s: %s", name, exc)
            failures.append(f"{name} ({exc})")
            return
        dur = time.time() - t0
        if cp.stdout:
            log.debug("stdout %s:\n%s", name, cp.stdout)
        if cp.stderr:
            log.debug("stderr %s:\n%s", name, cp.stderr)
        if cp.returncode == 0:
            log.info("%s: OK in %.1fs", name, dur)
        else:
            log.error("%s: EXIT=%d dopo %.1fs", name, cp.returncode, dur)
            failures.append(f"{name} (exit {cp.returncode})")

    if not skip_dircalib:
        script = ROOT / "scripts" / "_build_directional_calibration.py"
        if script.is_file():
            _run("directional_calibration", [py, "-u", str(script)], timeout_dircalib_min)
        else:
            log.warning("directional_calibration: script assente, skip")
    else:
        log.info("directional_calibration SKIPPATO")

    if not skip_cohort:
        script = ROOT / "scripts" / "investment_decision_cohort.py"
        if script.is_file():
            _run("investment_decision_cohort", [py, "-u", str(script)], timeout_cohort_min)
        else:
            log.warning("investment_decision_cohort: script assente, skip")
    else:
        log.info("investment_decision_cohort SKIPPATO")

    if not skip_live_signals:
        script = ROOT / "refresh_live_signals.py"
        if script.is_file():
            _run(
                "live_signals",
                [py, "-u", str(script), "--cd-horizon", str(cd_horizon)],
                timeout_live_min,
            )
        else:
            log.warning("live_signals: script assente, skip")
    else:
        log.info("live_signals SKIPPATO")

    sds_light_off = os.environ.get("SDS_LIGHT_REFRESH", "1").strip().lower() in (
        "0",
        "false",
        "no",
    )
    if not skip_sds_light and not sds_light_off:
        try:
            from prediction.sds_data import refresh_sds_cohort_light

            result = refresh_sds_cohort_light()
            log.info(
                "sds_light_refresh: n=%s mode=%s at=%s",
                result.get("n"),
                result.get("mode"),
                result.get("generated_at"),
            )
            try:
                from supernova_web_scheduler import bump_desktop_manifest

                bump_desktop_manifest()
            except Exception as exc:
                log.warning("sds_light_refresh manifest bump: %s", exc)
        except Exception as exc:
            log.warning("sds_light_refresh failed (non-fatal): %s", exc)
            failures.append(f"sds_light_refresh ({exc})")
    else:
        log.info("sds_light_refresh SKIPPATO")

    # Market context gate (XBI/TLT/VIX) — once per refresh session
    try:
        from prediction.market_context_gate import run as market_gate_run

        doc = market_gate_run()
        log.info(
            "market_context_gate: regime=%s xbi_5d=%s",
            doc.get("regime"),
            (doc.get("signals") or {}).get("xbi_5d_return"),
        )
    except Exception as exc:
        log.warning("market_context_gate failed (non-fatal): %s", exc)
        failures.append(f"market_context_gate ({exc})")

    # Sync regime-tagged outcomes after live signals (lightweight, every refresh)
    try:
        from prediction.regime_calibration import sync_outcomes_from_signal_audit

        n_sync = sync_outcomes_from_signal_audit()
        if n_sync:
            log.info("learning_lab: synced %d new outcome(s) with regime tag", n_sync)
    except Exception as exc:
        log.warning("learning_lab outcome sync failed (non-fatal): %s", exc)

    # Persist the weekly 3-channel learning-loop impact snapshot (every refresh).
    # Feeds the redesigned Model Recalibration tab (prediction/recommendation/trading).
    try:
        from prediction.learning_loop_channels import persist_weekly_channel_snapshot

        snap = persist_weekly_channel_snapshot()
        log.info("learning_loop_channels: weekly snapshot persisted (%d week(s))", len(snap.get("weeks") or {}))
    except Exception as exc:
        log.warning("learning_loop_channels snapshot failed (non-fatal): %s", exc)

    # Weekly learning cycle — cluster CF + regime multipliers (Sundays, after outcomes)
    import datetime as _dt

    if _dt.date.today().weekday() == 6:  # Sunday
        try:
            from prediction.learning_lab import run_learning_cycle

            lab = run_learning_cycle(dry_run=False)
            diff = lab.get("diff") or {}
            log.info(
                "learning_lab cycle: n_outcomes=%s cluster_changes=%d regime_changes=%d",
                lab.get("n_outcomes"),
                len(diff.get("cluster_changes") or []),
                len(diff.get("regime_changes") or []),
            )
        except Exception as exc:
            log.warning("learning_lab cycle failed (non-fatal): %s", exc)
            failures.append(f"learning_lab ({exc})")

    # Weekly validation feedback loop (Sundays)
    if _dt.date.today().weekday() == 6:  # Sunday
        try:
            from prediction.validation_feedback_loop import run_weekly

            fb = run_weekly(dry_run=False)
            log.info(
                "validation_feedback_loop: %d ticker(s), %d cal change(s)",
                fb.get("summary", {}).get("n_tickers", 0),
                len(fb.get("cal_factor_changes") or []),
            )
        except Exception as exc:
            # Surface as an error (was a swallowed warning): a silent failure here
            # left the dashboard stuck on "Collecting data" indefinitely.
            log.error("validation_feedback_loop failed: %s", exc, exc_info=True)
            failures.append(f"validation_feedback_loop ({exc})")

    return failures


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Post-refresh: KPI direzionali + cohort + live signals")
    ap.add_argument("--skip-dircalib", action="store_true")
    ap.add_argument("--no-cohort", action="store_true")
    ap.add_argument("--skip-live-signals", action="store_true")
    ap.add_argument("--skip-sds-light", action="store_true")
    ap.add_argument("--cd-horizon", type=int, default=None)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if not args.quiet else logging.WARNING,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    log = logging.getLogger("post_refresh_steps")
    log.info("Post-refresh steps — avvio")
    failures = run_post_refresh_steps(
        skip_dircalib=args.skip_dircalib,
        skip_cohort=args.no_cohort,
        skip_live_signals=args.skip_live_signals,
        skip_sds_light=args.skip_sds_light,
        cd_horizon=args.cd_horizon,
        logger=log,
    )
    if failures:
        log.error("Post-refresh completato CON ERRORI: %s", ", ".join(failures))
        return 1
    log.info("Post-refresh completato OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
