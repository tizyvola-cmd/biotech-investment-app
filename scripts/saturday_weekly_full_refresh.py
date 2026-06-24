#!/usr/bin/env python3
"""
saturday_weekly_full_refresh.py — Orchestrator WeeklyFull automatico il sabato.

Equivalente Linux/VPS di ``Biotech_Refresh_Profiles.ps1 -Profile WeeklyFull``:
  1. ``data_orchestrator.py`` con env profilo domenica (SEC K-8 attivo)
  2. ``post_refresh_steps.py`` (KPI + cohort + live signals)

Usato da:
  * ``supernova_web_scheduler`` (VPS con ``SUPERNOVA_SATURDAY_WEEKLY_FULL=1``)
  * Task Scheduler Windows: ``Setup_Weekly_Saturday_Full.ps1``
  * Cron standalone (se l'API non è sempre accesa):

    0 7 * * 6 cd /path/to/project && /path/to/python -u scripts/saturday_weekly_full_refresh.py --quiet

Uso:
    py -3 scripts/saturday_weekly_full_refresh.py
    py -3 scripts/saturday_weekly_full_refresh.py --force          # ignora check sabato
    py -3 scripts/saturday_weekly_full_refresh.py --force-yfinance   # fetch yfinance sempre
    py -3 scripts/saturday_weekly_full_refresh.py --dry-run
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from refresh_desktop_app import strip_daily_fast_env, weekly_full_env_patch

_SCRIPTS = _ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import daily_market_refresh as dm

acquire_lock = dm.acquire_lock
release_lock = dm.release_lock
run_step = dm.run_step
setup_logging = dm.setup_logging

_ORCHESTRATOR = _ROOT / "data_orchestrator.py"
_YF_JSON = _ROOT / "data" / "yf.json"
_STATUS_JSON = _ROOT / "data" / "saturday_weekly_full_last_run.json"
_ORCH_TIMEOUT_MIN = 150


def _yf_json_ready() -> bool:
    try:
        return _YF_JSON.is_file() and _YF_JSON.stat().st_size > 1000
    except OSError:
        return False


def build_weekly_full_env(*, force_yfinance: bool = False) -> dict[str, str]:
    env = strip_daily_fast_env(dict(os.environ))
    env.update(weekly_full_env_patch())
    if not force_yfinance and _yf_json_ready():
        env["ORCH_SKIP_FETCH"] = "1"
    else:
        env.pop("ORCH_SKIP_FETCH", None)
    return env


def is_saturday_today(*, force: bool = False) -> tuple[bool, str]:
    if force:
        return True, "force=True"
    today = dt.date.today()
    if today.weekday() != 5:
        return False, f"not Saturday ({today:%A})"
    return True, "Saturday"


def write_status(*, ok: bool, message: str, duration_sec: float) -> None:
    payload = {
        "ok": ok,
        "message": message,
        "duration_sec": round(duration_sec, 1),
        "finished_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    try:
        _STATUS_JSON.parent.mkdir(parents=True, exist_ok=True)
        _STATUS_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="WeeklyFull orchestrator (Saturday)")
    parser.add_argument("--force", action="store_true", help="Ignora check giorno sabato")
    parser.add_argument(
        "--force-yfinance",
        action="store_true",
        help="Includi fetch yfinance anche se yf.json è presente",
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra piano senza eseguire")
    parser.add_argument("--quiet", action="store_true", help="Log solo su file")
    args = parser.parse_args(argv)

    logger = setup_logging(verbose=not args.quiet, log_prefix="saturday_weekly_full")

    ok_day, day_reason = is_saturday_today(force=args.force)
    if not ok_day:
        logger.info("Skip: %s", day_reason)
        return 0

    if not _ORCHESTRATOR.is_file():
        logger.error("Script assente: %s", _ORCHESTRATOR)
        return 2

    env_patch = build_weekly_full_env(force_yfinance=args.force_yfinance)
    py = sys.executable
    orch_cmd = [py, "-u", str(_ORCHESTRATOR)]
    post_cmd = [py, "-u", str(_ROOT / "post_refresh_steps.py")]

    logger.info("WeeklyFull sabato — %s", day_reason)
    logger.info("ORCH_SKIP_FETCH=%s", env_patch.get("ORCH_SKIP_FETCH", "0"))
    if args.dry_run:
        logger.info("[dry-run] orchestrator: %s", " ".join(orch_cmd))
        logger.info("[dry-run] post_refresh: %s", " ".join(post_cmd))
        return 0

    if not acquire_lock(logger, max_age_minutes=_ORCH_TIMEOUT_MIN):
        return 3

    t0 = time.time()
    failures: list[str] = []
    try:
        code = run_step(
            logger,
            "data_orchestrator (WeeklyFull)",
            orch_cmd,
            extra_env=env_patch,
            timeout_min=_ORCH_TIMEOUT_MIN,
        )
        if code != 0:
            failures.append(f"data_orchestrator (exit {code})")
            write_status(ok=False, message=f"orchestrator exit {code}", duration_sec=time.time() - t0)
            return code or 1

        post_code = run_step(
            logger,
            "post_refresh_steps",
            post_cmd,
            timeout_min=45,
        )
        if post_code != 0:
            failures.append(f"post_refresh_steps (exit {post_code})")
            logger.warning("Post-refresh con errori (non bloccante per orchestrator)")

        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
        except Exception as exc:
            logger.warning("Manifest bump failed: %s", exc)

        duration = time.time() - t0
        if failures:
            write_status(ok=False, message="; ".join(failures), duration_sec=duration)
            return 1

        write_status(ok=True, message="WeeklyFull completato", duration_sec=duration)
        logger.info("WeeklyFull sabato OK (%.1f min)", duration / 60)
        return 0
    finally:
        release_lock(logger)


if __name__ == "__main__":
    raise SystemExit(main())
