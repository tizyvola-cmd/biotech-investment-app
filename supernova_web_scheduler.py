"""
Background scheduler for web host mode (``SUPERNOVA_SERVE_DESKTOP=1``).

Schedule (``Europe/Rome`` by default):

* **Hourly financial** (``SUPERNOVA_HOURLY_FINANCIAL=1``):
  Lun–Ven 15:30–22:00 → ``scripts/hourly_financial_refresh.py`` (quote + live signals).

* **Morning research** (``SUPERNOVA_MORNING_REFRESH=1``):
  Lun–Ven 07:00 → ``scripts/morning_research_refresh.py`` (CD + IPO).

* **SDS cohort refresh** (``SUPERNOVA_SDS_REFRESH=1``):
  Lun–Ven 09:00 → ``scripts/sds_cohort_refresh.py`` (ricalcolo completo coorte Supernova).

* **EIS / clinical feed** (``SUPERNOVA_EIS_REFRESH=1``):
  Lun–Ven 10:00 → ``scripts/eis_morning_refresh.py`` (feed pre-CD + calibrazione EIS + popup report).

* **Model Lab accuracy** (``SUPERNOVA_MODEL_LAB_REFRESH=1``):
  Lun–Ven 16:30 → ``scripts/model_lab_accuracy_refresh.py`` (RA Calibration + SDS Accuracy + EIS Magnitude).

* **Saturday WeeklyFull** (``SUPERNOVA_SATURDAY_WEEKLY_FULL=1``):
  Sabato 07:00–14:00 → ``scripts/saturday_weekly_full_refresh.py`` (orchestrator completo + SEC K-8).

* **Legacy hourly live** (``SUPERNOVA_SCHEDULED_REFRESH_MINUTES`` > 0, hourly financial off):
  ``refresh_live_signals.py`` every N minutes Mon–Fri.

* **Legacy daily** (``SUPERNOVA_DAILY_REFRESH_HOUR`` >= 0):
  ``scripts/daily_market_refresh.py`` once per day at that local hour.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import threading
import time
from datetime import date, datetime, time as dt_time
from pathlib import Path

from orchestrator_io_paths import DESKTOP_DATA_MANIFEST_JSON, project_root
from supernova_config import SupernovaConfig
from supernova_schedule import (
    parse_hhmm,
    rome_now,
    should_run_eis_refresh,
    should_run_hourly_financial,
    should_run_model_lab_refresh,
    should_run_morning_refresh,
    should_run_saturday_weekly_full,
    should_run_sds_refresh,
)

logger = logging.getLogger(__name__)

ROOT = Path(project_root())
_PYTHON = Path(sys.executable)
_LIVE_SIGNALS = ROOT / "refresh_live_signals.py"
_DAILY_REFRESH = ROOT / "scripts" / "daily_market_refresh.py"
_HOURLY_FINANCIAL = ROOT / "scripts" / "hourly_financial_refresh.py"
_MORNING_RESEARCH = ROOT / "scripts" / "morning_research_refresh.py"
_SDS_COHORT_REFRESH = ROOT / "scripts" / "sds_cohort_refresh.py"
_EIS_MORNING_REFRESH = ROOT / "scripts" / "eis_morning_refresh.py"
_MODEL_LAB_ACCURACY_REFRESH = ROOT / "scripts" / "model_lab_accuracy_refresh.py"
_SATURDAY_WEEKLY_FULL = ROOT / "scripts" / "saturday_weekly_full_refresh.py"
_LOCK = threading.Lock()
_last_daily_run: date | None = None
_last_hourly_slot: int | None = None
_last_hourly_date: date | None = None
_last_morning_date: date | None = None
_last_sds_date: date | None = None
_last_eis_date: date | None = None
_last_model_lab_date: date | None = None
_last_saturday_weekly_full_date: date | None = None


def bump_desktop_manifest() -> None:
    """Aggiorna ``updated_at`` nel manifest (trigger reload UI)."""
    from datetime import timezone

    p = Path(DESKTOP_DATA_MANIFEST_JSON)
    manifest: dict = {}
    if p.is_file():
        try:
            manifest = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = {}
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


def _run_subprocess(script: Path, *extra: str) -> int:
    if not script.is_file():
        logger.warning("Scheduler: script assente %s", script)
        return 127
    if not _PYTHON.is_file():
        logger.warning("Scheduler: Python non trovato %s", _PYTHON)
        return 127
    proc = subprocess.run(
        [str(_PYTHON), "-u", str(script), *extra],
        cwd=str(ROOT),
        env=None,
    )
    return int(proc.returncode or 0)


def run_hourly_live_refresh(*, cd_horizon: str = "60") -> bool:
    """Live signals + manifest bump. Returns True on success."""
    with _LOCK:
        code = _run_subprocess(_LIVE_SIGNALS, "--cd-horizon", cd_horizon)
        if code != 0:
            logger.warning("Scheduler: refresh_live_signals exit %s", code)
            return False
        try:
            bump_desktop_manifest()
        except OSError as exc:
            logger.warning("Scheduler: manifest bump failed: %s", exc)
            return False
    logger.info("Scheduler: hourly live refresh OK")
    return True


def run_hourly_financial_refresh() -> bool:
    """Quote Yahoo + Financial snapshot + live signals."""
    global _last_hourly_slot, _last_hourly_date
    with _LOCK:
        code = _run_subprocess(_HOURLY_FINANCIAL, "--quiet")
        if code != 0:
            logger.warning("Scheduler: hourly_financial_refresh exit %s", code)
            return False
    logger.info("Scheduler: hourly financial refresh OK")
    return True


def run_morning_research_refresh() -> bool:
    """CD scan + new bio IPO."""
    global _last_morning_date
    with _LOCK:
        code = _run_subprocess(_MORNING_RESEARCH, "--quiet")
        if code != 0:
            logger.warning("Scheduler: morning_research_refresh exit %s", code)
            return False
    logger.info("Scheduler: morning research refresh OK")
    return True


def run_sds_cohort_refresh(*, mode: str = "full") -> bool:
    """Full SDS cohort recompute (FMP + cluster A) or sync-only for new entrants."""
    global _last_sds_date
    with _LOCK:
        code = _run_subprocess(_SDS_COHORT_REFRESH, "--mode", mode, "--quiet")
        if code != 0:
            logger.warning("Scheduler: sds_cohort_refresh exit %s", code)
            return False
    logger.info("Scheduler: SDS cohort refresh OK (mode=%s)", mode)
    return True


def run_eis_morning_refresh() -> bool:
    """Clinical pre-CD feed + EIS calibration + UI report."""
    global _last_eis_date
    with _LOCK:
        code = _run_subprocess(_EIS_MORNING_REFRESH, "--quiet")
        if code != 0:
            logger.warning("Scheduler: eis_morning_refresh exit %s", code)
            return False
    logger.info("Scheduler: EIS morning refresh OK")
    return True


def run_model_lab_accuracy_refresh() -> bool:
    """RA Calibration + SDS Accuracy data refresh + manifest timestamps."""
    global _last_model_lab_date
    with _LOCK:
        code = _run_subprocess(_MODEL_LAB_ACCURACY_REFRESH, "--quiet")
        if code != 0:
            logger.warning("Scheduler: model_lab_accuracy_refresh exit %s", code)
            return False
    logger.info("Scheduler: Model Lab accuracy refresh OK")
    return True


def run_saturday_weekly_full_refresh() -> bool:
    """Orchestrator WeeklyFull (SEC K-8 + enrich completi). Run lungo (30–90+ min)."""
    global _last_saturday_weekly_full_date
    with _LOCK:
        code = _run_subprocess(_SATURDAY_WEEKLY_FULL, "--quiet")
        if code != 0:
            logger.warning("Scheduler: saturday_weekly_full_refresh exit %s", code)
            return False
    logger.info("Scheduler: Saturday WeeklyFull refresh OK")
    return True


def run_daily_market_refresh() -> bool:
    """Full daily fast refresh (Simulation + KPI + live signals)."""
    global _last_daily_run
    today = date.today()
    with _LOCK:
        if _last_daily_run == today:
            return True
        code = _run_subprocess(_DAILY_REFRESH)
        if code != 0:
            logger.warning("Scheduler: daily_market_refresh exit %s", code)
            return False
        _last_daily_run = today
    logger.info("Scheduler: daily market refresh OK")
    return True


def _scheduler_loop(cfg: SupernovaConfig, stop: threading.Event) -> None:
    global _last_hourly_slot, _last_hourly_date, _last_morning_date, _last_sds_date, _last_eis_date, _last_model_lab_date, _last_daily_run, _last_saturday_weekly_full_date

    poll_sec = max(30, cfg.scheduler_poll_seconds)
    daily_hour = cfg.daily_refresh_hour
    hourly_start = parse_hhmm(cfg.hourly_financial_start, default=dt_time(15, 30))
    hourly_end = parse_hhmm(cfg.hourly_financial_end, default=dt_time(22, 0))
    morning_at = parse_hhmm(cfg.morning_refresh_time, default=dt_time(7, 0))
    sds_at = parse_hhmm(cfg.sds_refresh_time, default=dt_time(9, 0))
    eis_at = parse_hhmm(cfg.eis_refresh_time, default=dt_time(10, 0))
    model_lab_at = parse_hhmm(cfg.model_lab_refresh_time, default=dt_time(16, 30))
    saturday_at = parse_hhmm(cfg.saturday_weekly_full_time, default=dt_time(7, 0))
    saturday_end = parse_hhmm(cfg.saturday_weekly_full_window_end, default=dt_time(14, 0))

    schedule_bits = ""
    if cfg.hourly_financial_enabled:
        schedule_bits += f", hourly financial {hourly_start:%H:%M}-{hourly_end:%H:%M} Lun-Ven"
    if cfg.morning_refresh_enabled:
        schedule_bits += f", morning {morning_at:%H:%M} Lun-Ven"
    if cfg.sds_refresh_enabled:
        schedule_bits += f", SDS {sds_at:%H:%M} Lun-Ven"
    if cfg.eis_refresh_enabled:
        schedule_bits += f", EIS feed {eis_at:%H:%M} Lun-Ven"
    if cfg.model_lab_refresh_enabled:
        schedule_bits += f", Model Lab {model_lab_at:%H:%M} Lun-Ven"
    if cfg.saturday_weekly_full_enabled:
        schedule_bits += f", WeeklyFull Sab {saturday_at:%H:%M}-{saturday_end:%H:%M}"
    if cfg.scheduled_refresh_minutes > 0 and not cfg.hourly_financial_enabled:
        schedule_bits += f", legacy live ogni {cfg.scheduled_refresh_minutes} min"
    if daily_hour >= 0:
        schedule_bits += f", legacy daily alle {daily_hour:02d}:00"

    logger.info(
        "Web scheduler avviato (poll %ss, tz=%s%s)",
        poll_sec,
        cfg.schedule_timezone,
        schedule_bits,
    )

    legacy_interval_sec = max(60, cfg.scheduled_refresh_minutes * 60) if cfg.scheduled_refresh_minutes > 0 else 0
    last_legacy_live = 0.0

    while not stop.wait(timeout=poll_sec):
        now_local = rome_now(tz_name=cfg.schedule_timezone)
        today = now_local.date()

        # ── Saturday WeeklyFull (priority — run lungo, app chiusa ok) ──
        if cfg.saturday_weekly_full_enabled and should_run_saturday_weekly_full(
            now_local,
            at=saturday_at,
            last_date=_last_saturday_weekly_full_date,
            window_end=saturday_end,
        ):
            if run_saturday_weekly_full_refresh():
                _last_saturday_weekly_full_date = today
            continue

        # ── Morning CD + IPO (priority) ──
        if cfg.morning_refresh_enabled and should_run_morning_refresh(
            now_local,
            at=morning_at,
            last_date=_last_morning_date,
        ):
            run_morning_research_refresh()
            _last_morning_date = today
            continue

        # ── SDS full refresh (09:00 default) ──
        if cfg.sds_refresh_enabled and should_run_sds_refresh(
            now_local,
            at=sds_at,
            last_date=_last_sds_date,
        ):
            run_sds_cohort_refresh(mode="full")
            _last_sds_date = today
            continue

        # ── EIS / clinical feed (10:00 default) ──
        if cfg.eis_refresh_enabled and should_run_eis_refresh(
            now_local,
            at=eis_at,
            last_date=_last_eis_date,
        ):
            run_eis_morning_refresh()
            _last_eis_date = today
            continue

        # ── Hourly financial (15:30–22:00 IT) ──
        if cfg.hourly_financial_enabled and should_run_hourly_financial(
            now_local,
            start=hourly_start,
            end=hourly_end,
            last_slot=_last_hourly_slot,
            last_date=_last_hourly_date,
        ):
            slot = (now_local.hour * 60 + now_local.minute - hourly_start.hour * 60 - hourly_start.minute) // 60
            if run_hourly_financial_refresh():
                _last_hourly_slot = int(slot)
                _last_hourly_date = today
            continue

        # ── Model Lab RA/SDS accuracy (16:30 default, after hourly quotes) ──
        if cfg.model_lab_refresh_enabled and should_run_model_lab_refresh(
            now_local,
            at=model_lab_at,
            last_date=_last_model_lab_date,
        ):
            run_model_lab_accuracy_refresh()
            _last_model_lab_date = today
            continue

        # ── Legacy daily full refresh ──
        if daily_hour >= 0 and now_local.hour == daily_hour and _last_daily_run != today:
            run_daily_market_refresh()
            continue

        # ── Legacy hourly live (all weekday hours) ──
        if (
            not cfg.hourly_financial_enabled
            and cfg.scheduled_refresh_minutes > 0
            and now_local.weekday() < 5
        ):
            now_ts = time.monotonic()
            if now_ts - last_legacy_live >= legacy_interval_sec:
                run_hourly_live_refresh()
                last_legacy_live = now_ts


def start_web_scheduler(cfg: SupernovaConfig) -> threading.Event | None:
    """Avvia thread daemon se almeno un job schedulato è configurato."""
    enabled = (
        cfg.hourly_financial_enabled
        or cfg.morning_refresh_enabled
        or cfg.sds_refresh_enabled
        or cfg.eis_refresh_enabled
        or         cfg.model_lab_refresh_enabled
        or cfg.saturday_weekly_full_enabled
        or cfg.scheduled_refresh_minutes > 0
        or cfg.daily_refresh_hour >= 0
    )
    if not enabled:
        return None
    stop = threading.Event()
    threading.Thread(
        target=_scheduler_loop,
        args=(cfg, stop),
        daemon=True,
        name="supernova-web-scheduler",
    ).start()
    return stop


__all__ = [
    "bump_desktop_manifest",
    "run_daily_market_refresh",
    "run_hourly_financial_refresh",
    "run_hourly_live_refresh",
    "run_morning_research_refresh",
    "run_sds_cohort_refresh",
    "run_eis_morning_refresh",
    "run_model_lab_accuracy_refresh",
    "run_saturday_weekly_full_refresh",
    "start_web_scheduler",
]
