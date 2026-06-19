#!/usr/bin/env python3
"""
daily_market_refresh.py — Refresh automatico giornaliero (Lun–Ven 16:00 ora IT).

Esegue il "fast refresh" del progetto:
  1. Fetch prezzi/quotes da Yahoo Finance e Finnhub (per Finance tab)
  2. Ricalibrazione curve (slope_5d/20d/45d, run_up, target/stop)
  3. Aggiornamento foglio Simulation (Decision Lab "Segnali Attivi")
  4. Aggiornamento foglio Accuracy (Diagnostica predittiva)
5. Rigenerazione KPI direzionali Raw/Utile/Forte
6. Rigenerazione cohort Investment Decision Lab
7. **Refresh live signals** (pred5, affid → audit Pre-CD) — dopo Simulation
8. **SDS light refresh** (Cluster C+E da prezzi/live; A/B/D da cache)
8. **Lunedì**: fetch clinico incrementale (`BiotechClinicalTrialDataFetcher.py`, cache 14 gg)
   prima del fast refresh, così nuovi studi CT.gov entrano in Simulation

Differenze rispetto al `refresh_fast.py` diretto:
  * Registra logging strutturato su file (data/logs/daily_refresh_YYYYMMDD.log)
  * Skip automatico nel weekend (sabato/domenica) salvo flag --force
  * Skip nei festivi NYSE noti (Capodanno, Independence Day, ecc.)
  * Avvisa se l'Excel è aperto e tenta retry dopo 60s (non vuoi un fallimento
    silenzioso nel task scheduler perché l'utente ha tenuto aperto il file).
  * Lock-file in data/.refresh_running.lock per evitare doppi run sovrapposti.

Uso:
    py -3 scripts/daily_market_refresh.py
    py -3 scripts/daily_market_refresh.py --force            # ignora weekend/holiday
    py -3 scripts/daily_market_refresh.py --dry-run          # mostra cosa farebbe
    py -3 scripts/daily_market_refresh.py --skip-dircalib    # salta solo i KPI
    py -3 scripts/daily_market_refresh.py --no-cohort        # salta cohort decision lab

Registrato come Task Scheduler via:
    scripts/Setup_Daily_Market_Refresh.ps1
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from refresh_desktop_app import daily_refresh_env_patch


# ── Festivi NYSE 2026 (skip refresh) ──────────────────────────────────────────
# Aggiornare ogni anno. Sono i giorni in cui Yahoo/Finnhub non hanno close
# definitivo dei titoli US, quindi è uno spreco di chiamate API.
NYSE_HOLIDAYS_2026 = {
    dt.date(2026, 1, 1),    # New Year's Day
    dt.date(2026, 1, 19),   # MLK Day
    dt.date(2026, 2, 16),   # Presidents Day
    dt.date(2026, 4, 3),    # Good Friday
    dt.date(2026, 5, 25),   # Memorial Day
    dt.date(2026, 6, 19),   # Juneteenth
    dt.date(2026, 7, 3),    # Independence Day observed
    dt.date(2026, 9, 7),    # Labor Day
    dt.date(2026, 11, 26),  # Thanksgiving
    dt.date(2026, 12, 25),  # Christmas
}

NYSE_HOLIDAYS_2027 = {
    dt.date(2027, 1, 1),
    dt.date(2027, 1, 18),
    dt.date(2027, 2, 15),
    dt.date(2027, 3, 26),
    dt.date(2027, 5, 31),
    dt.date(2027, 6, 18),
    dt.date(2027, 7, 5),
    dt.date(2027, 9, 6),
    dt.date(2027, 11, 25),
    dt.date(2027, 12, 24),
}

NYSE_HOLIDAYS = NYSE_HOLIDAYS_2026 | NYSE_HOLIDAYS_2027


LOG_DIR  = _ROOT / "data" / "logs"
LOCK_FILE = _ROOT / "data" / ".refresh_running.lock"


def setup_logging(verbose: bool = True, *, log_prefix: str = "daily_refresh") -> logging.Logger:
    """Configura logging su file + stdout."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{log_prefix}_{dt.date.today():%Y%m%d}.log"

    logger = logging.getLogger(log_prefix)
    logger.setLevel(logging.DEBUG)
    # Rimuovi handler preesistenti per evitare duplicazioni in re-import
    for h in list(logger.handlers):
        logger.removeHandler(h)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    if verbose:
        sh = logging.StreamHandler(sys.stdout)
        sh.setLevel(logging.INFO)
        sh.setFormatter(fmt)
        logger.addHandler(sh)

    return logger


def is_market_day(today: dt.date, *, force: bool = False) -> tuple[bool, str]:
    """
    Restituisce (esegui_refresh, motivo) per il giorno indicato.
    Con ``force=True`` esegue sempre.
    """
    if force:
        return True, "force=True"
    weekday = today.weekday()  # 0=lun, 6=dom
    if weekday >= 5:
        return False, f"weekend ({today:%A})"
    if today in NYSE_HOLIDAYS:
        return False, f"NYSE holiday ({today})"
    return True, "trading day"


def acquire_lock(logger: logging.Logger, *, max_age_minutes: int = 60) -> bool:
    """
    Tenta di acquisire il lock file. Restituisce True se ok.
    Se il lock esiste ma è più vecchio di ``max_age_minutes``, lo considera
    stale e lo sovrascrive (evita freeze permanenti).
    """
    if LOCK_FILE.exists():
        try:
            mtime = dt.datetime.fromtimestamp(LOCK_FILE.stat().st_mtime)
        except OSError:
            mtime = dt.datetime.min
        age_min = (dt.datetime.now() - mtime).total_seconds() / 60
        if age_min < max_age_minutes:
            logger.warning(
                "Lock file presente (età %.1f min) — un altro refresh sembra in corso. Abort.",
                age_min,
            )
            return False
        logger.warning("Lock file stale (%.1f min) — lo sovrascrivo.", age_min)
    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(
            f"pid={os.getpid()}\nstarted={dt.datetime.now().isoformat()}\n",
            encoding="utf-8",
        )
        return True
    except OSError as exc:
        logger.error("Impossibile scrivere lock file: %s", exc)
        return False


def release_lock(logger: logging.Logger) -> None:
    try:
        LOCK_FILE.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Impossibile rimuovere lock file: %s", exc)


def touch_lock(logger: logging.Logger) -> None:
    """Aggiorna mtime del lock durante run lunghi (clinical + fast)."""
    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(
            f"pid={os.getpid()}\nupdated={dt.datetime.now().isoformat()}\n",
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("touch_lock: %s", exc)


def run_step(
    logger: logging.Logger,
    name: str,
    cmd: list[str],
    *,
    cwd: Path = _ROOT,
    timeout_min: int = 30,
    extra_env: dict[str, str] | None = None,
) -> int:
    """Esegue un sub-step. Logga durata + exit code. Restituisce exit code."""
    logger.info("─" * 60)
    logger.info("STEP: %s", name)
    logger.info("CMD : %s", " ".join(cmd))
    t0 = time.time()
    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    if extra_env:
        env.update(extra_env)
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            timeout=timeout_min * 60,
            env=env,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        logger.error("%s: TIMEOUT dopo %d min", name, timeout_min)
        return 124
    except OSError as exc:
        logger.error("%s: errore di esecuzione: %s", name, exc)
        return 127

    dur = time.time() - t0
    if proc.stdout:
        logger.debug("--- stdout %s ---\n%s", name, proc.stdout)
    if proc.stderr:
        logger.debug("--- stderr %s ---\n%s", name, proc.stderr)
    if proc.returncode == 0:
        logger.info("%s: OK in %.1fs", name, dur)
    else:
        logger.error("%s: EXIT=%d dopo %.1fs", name, proc.returncode, dur)
    return proc.returncode


def find_python() -> str:
    """Restituisce il path all'interprete Python da usare."""
    venv_py = _ROOT / ".venv" / "Scripts" / "python.exe"
    if venv_py.exists():
        return str(venv_py)
    # Fallback al python corrente
    return sys.executable or "python"


def main() -> int:
    ap = argparse.ArgumentParser(description="Daily market refresh (Lun–Ven 16:00 IT)")
    ap.add_argument("--force",         action="store_true", help="esegui anche nei weekend/festivi")
    ap.add_argument("--dry-run",       action="store_true", help="mostra cosa farebbe senza eseguire")
    ap.add_argument("--skip-fast",     action="store_true", help="salta refresh_fast.py")
    ap.add_argument("--skip-dircalib", action="store_true", help="salta KPI direzionali")
    ap.add_argument("--no-cohort",     action="store_true", help="salta cohort decision lab")
    ap.add_argument("--skip-live-signals", action="store_true", help="salta refresh_live_signals.py")
    ap.add_argument("--skip-sds-light", action="store_true", help="salta SDS light refresh (Cluster C+E)")
    ap.add_argument("--skip-clinical-weekly", action="store_true",
                    help="salta fetch clinico settimanale (anche se è lunedì)")
    ap.add_argument("--force-clinical-weekly", action="store_true",
                    help="forza fetch clinico oggi (indipendentemente dal giorno)")
    ap.add_argument("--clinical-weekday", type=int, default=None,
                    help="giorno settimanale fetch clinico (0=lun … 6=dom; default env o lunedì)")
    ap.add_argument("--cd-horizon", type=int, default=None,
                    help="orizzonte CD per live signals (default 60 giorni)")
    ap.add_argument("--timeout-fast",  type=int, default=30, help="timeout fast refresh (min)")
    ap.add_argument("--timeout-clinical", type=int, default=180,
                    help="timeout fetch clinico settimanale (min)")
    ap.add_argument("--timeout-live", type=int, default=15, help="timeout live signals (min)")
    ap.add_argument("--quiet",         action="store_true", help="solo logging su file")
    args = ap.parse_args()

    logger = setup_logging(verbose=not args.quiet)
    today  = dt.date.today()
    now    = dt.datetime.now()

    logger.info("=" * 60)
    logger.info("Daily market refresh — avvio %s", now.isoformat(timespec="seconds"))
    logger.info("Project root: %s", _ROOT)

    ok, reason = is_market_day(today, force=args.force)
    if not ok:
        logger.info("Refresh SKIPPATO: %s", reason)
        return 0
    logger.info("Giorno di mercato (%s)", reason)

    if args.dry_run:
        logger.info("DRY-RUN: nessuna esecuzione, solo controllo prerequisiti.")
        return 0

    if not acquire_lock(logger, max_age_minutes=300):
        return 2

    py = find_python()
    logger.info("Python: %s", py)

    failures: list[str] = []
    try:
        # ── Step 0 (settimanale): clinical CT.gov incrementale (cache 14 gg per società) ──
        clinical_dow = args.clinical_weekday
        if clinical_dow is None:
            try:
                clinical_dow = int(os.environ.get("CLINICAL_WEEKLY_WEEKDAY", "0"))
            except ValueError:
                clinical_dow = 0
        run_clinical_weekly = (
            args.force_clinical_weekly
            or (not args.skip_clinical_weekly and today.weekday() == clinical_dow)
        )
        if run_clinical_weekly:
            logger.info(
                "Step clinico settimanale (weekday=%s) — BiotechClinicalTrialDataFetcher",
                today.strftime("%A"),
            )
            rc = run_step(
                logger,
                name="clinical_incremental",
                cmd=[py, "-u", "BiotechClinicalTrialDataFetcher.py"],
                timeout_min=args.timeout_clinical,
            )
            if rc != 0:
                failures.append(f"clinical_incremental (exit {rc})")
            touch_lock(logger)
        else:
            logger.info(
                "Step clinico settimanale SKIPPATO (prossimo: weekday %s, oggi %s)",
                ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][clinical_dow],
                today.strftime("%A"),
            )

        # ── Step 1: refresh fast (yfinance + finnhub + curve + Simulation + Accuracy) ──
        if not args.skip_fast:
            rc = run_step(
                logger,
                name="refresh_fast",
                cmd=[py, "-u", "refresh_fast.py"],
                timeout_min=args.timeout_fast,
                # Env identico al profilo "Daily" dei .bat esistenti
                extra_env={
                    **daily_refresh_env_patch(),
                    # Quote refresh: 1h durante orario di mercato (refresh alle 16
                    # IT = 10 EST, sessione aperta → richiedi dati freschi)
                    "YF_QUOTE_REFRESH_HOURS": "1",
                },
            )
            if rc != 0:
                failures.append(f"refresh_fast (exit {rc})")
            touch_lock(logger)
        else:
            logger.info("Step refresh_fast SKIPPATO (--skip-fast)")

        # ── Step 2–4: KPI direzionali, cohort, live signals ──
        from post_refresh_steps import run_post_refresh_steps

        post_failures = run_post_refresh_steps(
            skip_dircalib=args.skip_dircalib,
            skip_cohort=args.no_cohort,
            skip_live_signals=args.skip_live_signals,
            skip_sds_light=args.skip_sds_light,
            cd_horizon=args.cd_horizon,
            timeout_dircalib_min=5,
            timeout_cohort_min=10,
            timeout_live_min=args.timeout_live,
            logger=logger,
        )
        failures.extend(post_failures)
        touch_lock(logger)

    finally:
        release_lock(logger)

    # ── Riepilogo ──
    logger.info("=" * 60)
    duration = (dt.datetime.now() - now).total_seconds() / 60
    if failures:
        logger.error("REFRESH COMPLETATO CON ERRORI (%.1f min): %s",
                     duration, ", ".join(failures))
        return 1
    logger.info("REFRESH COMPLETATO OK (%.1f min)", duration)
    return 0


if __name__ == "__main__":
    sys.exit(main())
