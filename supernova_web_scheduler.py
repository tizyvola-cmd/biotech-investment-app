"""
Background scheduler for web host mode (``SUPERNOVA_SERVE_DESKTOP=1``).

Schedule (``Europe/Rome`` by default):

* **Hourly financial** (``SUPERNOVA_HOURLY_FINANCIAL=1``):
  Lun–Ven 15:30–22:00 → ``scripts/hourly_financial_refresh.py`` (quote + live signals).

* **Morning research** (``SUPERNOVA_MORNING_REFRESH=1``):
  Lun–Ven 07:00 → ``scripts/morning_research_refresh.py`` (CD + IPO + hype volume).
  Lun–Ven ~07:05 → Calendar → Wind / Catalyst promote (eventi ≤60g / 2 mesi).
  Lun–Ven ~07:10 → Catalyst desk morning cache (Ticker/Event/Days + Insider + Exec Exit + FDA Brief).

* **SDS cohort refresh** (``SUPERNOVA_SDS_REFRESH=1``):
  Lun–Ven 09:00 → ``scripts/sds_cohort_refresh.py`` (ricalcolo completo coorte Supernova).
  Lun–Ven 09:00 → Daily News desk (latest company news / press) + ogni ora fino a 22:00;
  dopo l’ora di discovery le news migrano nelle EIS company.

* **EIS / clinical feed** (``SUPERNOVA_EIS_REFRESH=1``):
  Lun–Ven 10:00 → ``scripts/eis_morning_refresh.py`` (feed pre-CD + calibrazione EIS + popup report).

* **Guidance Calendar** (tab Calendar):
  Lunedì ~10:30 Rome → refresh snapshot settimanale (orizzonte 6 mesi).
  Catch-up automatico martedì–domenica se il lunedì è stato saltato (server down).

* **Model Lab accuracy** (``SUPERNOVA_MODEL_LAB_REFRESH=1``):
  Lun–Ven 16:30 → ``scripts/model_lab_accuracy_refresh.py`` (RA Calibration + SDS Accuracy + EIS Magnitude).

* **Saturday WeeklyFull** (``SUPERNOVA_SATURDAY_WEEKLY_FULL=1``):
  Sabato 07:00–14:00 → ``scripts/saturday_weekly_full_refresh.py`` (orchestrator completo + SEC K-8).

* **8-K Financial tab** :
  Mercoledì 07:15 Rome → rilegge gli 8-K EDGAR degli ultimi 2 mesi (summary 50 parole per Item + score).

* **Google Trends** (``SUPERNOVA_TRENDS`` default on):
  NYSE open days → 3×/day (10:00, 16:00, 21:00 Rome). Weekend / holidays → 11:30 and 17:00.

* **FDA AdCom calendar**:
  1° del mese 07:15 Rome → ripopola i prossimi 3 mesi (solo ticker NASDAQ).
  Ogni giorno 07:45 Rome → se un meeting è a ≤2 giorni, cerca i briefing materials.

* **Universe Discovery Screener**:
  2° del mese 07:30 Rome → EDGAR full-text (8-K, keyword A/B, SIC biotech) fuori watchlist.
  Auto-enqueue → Calendar; 2° ≥08:00 Rome → SEC Calendar refresh mensile (Sim+Discovery).

* **Catalyst UOA volume history**:
  Giornaliero ~08:25 Rome → snapshot Yahoo option chain (volume/OI per strike)
  per costruire AvgVol 20g e abilitare la colonna UOA.

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
    should_run_trends_refresh,
    trends_refresh_slot_id,
    should_run_guidance_calendar_weekly,
    should_run_8k_dossier_weekly,
    iso_week_key,
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
_last_hot_zone_migrate_date: date | None = None
_last_desk_morning_cache_date: date | None = None
_last_desk_hourly_slot: int | None = None
_last_desk_hourly_date: date | None = None
_last_sds_date: date | None = None
_last_daily_news_date: date | None = None
_last_daily_news_hour: int | None = None
_last_eis_date: date | None = None
_last_guidance_cal_week: str | None = None
_last_8k_dossier_week: str | None = None
_last_model_lab_date: date | None = None
_last_saturday_weekly_full_date: date | None = None
_last_trends_slot: str | None = None
_last_fda_adcom_month: str | None = None
_last_universe_discovery_month: str | None = None
_last_catalyst_calendar_month: str | None = None
_last_fda_briefing_date: date | None = None  # legacy day marker
_last_fda_briefing_at: datetime | None = None
_last_event_vol_date: date | None = None
_last_catalyst_si_date: date | None = None
_last_catalyst_uoa_date: date | None = None

# Cursors live in memory only unless persisted. A gunicorn restart (deploy,
# or a worker killed mid-job) used to re-run Wednesday 8-K, Trends, and the
# morning pipeline inside the same workers that serve users.
_STATE_PATH = ROOT / "data" / "runtime" / "web_scheduler_state.json"
_BOOT_GRACE_S = 90.0

_DATE_STATE_KEYS = (
    ("morning_date", "_last_morning_date"),
    ("hot_zone_migrate_date", "_last_hot_zone_migrate_date"),
    ("desk_morning_cache_date", "_last_desk_morning_cache_date"),
    ("desk_hourly_date", "_last_desk_hourly_date"),
    ("hourly_date", "_last_hourly_date"),
    ("sds_date", "_last_sds_date"),
    ("daily_news_date", "_last_daily_news_date"),
    ("eis_date", "_last_eis_date"),
    ("model_lab_date", "_last_model_lab_date"),
    ("daily_run", "_last_daily_run"),
    ("saturday_weekly_full_date", "_last_saturday_weekly_full_date"),
    ("fda_briefing_date", "_last_fda_briefing_date"),
    ("event_vol_date", "_last_event_vol_date"),
    ("catalyst_si_date", "_last_catalyst_si_date"),
    ("catalyst_uoa_date", "_last_catalyst_uoa_date"),
)
_STR_STATE_KEYS = (
    ("guidance_cal_week", "_last_guidance_cal_week"),
    ("k8_dossier_week", "_last_8k_dossier_week"),
    ("trends_slot", "_last_trends_slot"),
    ("fda_adcom_month", "_last_fda_adcom_month"),
    ("universe_discovery_month", "_last_universe_discovery_month"),
    ("catalyst_calendar_month", "_last_catalyst_calendar_month"),
)
_INT_STATE_KEYS = (
    ("hourly_slot", "_last_hourly_slot"),
    ("desk_hourly_slot", "_last_desk_hourly_slot"),
    ("daily_news_hour", "_last_daily_news_hour"),
)


def load_scheduler_state() -> None:
    """Restore last-run cursors so a restart does not replay today's jobs."""
    g = globals()
    if not _STATE_PATH.is_file():
        return
    try:
        raw = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Scheduler state unreadable: %s", exc)
        return
    if not isinstance(raw, dict):
        return
    for key, name in _DATE_STATE_KEYS:
        text = str(raw.get(key) or "")[:10]
        try:
            g[name] = date.fromisoformat(text) if text else None
        except ValueError:
            g[name] = None
    for key, name in _STR_STATE_KEYS:
        val = raw.get(key)
        g[name] = str(val) if val else None
    for key, name in _INT_STATE_KEYS:
        val = raw.get(key)
        try:
            g[name] = int(val) if val is not None and val != "" else None
        except (TypeError, ValueError):
            g[name] = None
    briefing = raw.get("fda_briefing_at")
    if briefing:
        try:
            g["_last_fda_briefing_at"] = datetime.fromisoformat(str(briefing))
        except ValueError:
            g["_last_fda_briefing_at"] = None
    logger.info("Scheduler state restored from %s", _STATE_PATH.name)


def save_scheduler_state() -> None:
    g = globals()
    payload: dict = {}
    for key, name in _DATE_STATE_KEYS:
        val = g.get(name)
        payload[key] = val.isoformat() if isinstance(val, date) else None
    for key, name in _STR_STATE_KEYS:
        payload[key] = g.get(name)
    for key, name in _INT_STATE_KEYS:
        payload[key] = g.get(name)
    briefing = g.get("_last_fda_briefing_at")
    payload["fda_briefing_at"] = (
        briefing.isoformat() if isinstance(briefing, datetime) else None
    )
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _STATE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(_STATE_PATH)
    except OSError as exc:
        logger.warning("Scheduler state save failed: %s", exc)


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
    """CD scan + new bio IPO + daily volume-hype funnel."""
    global _last_morning_date
    with _LOCK:
        code = _run_subprocess(_MORNING_RESEARCH, "--quiet")
        if code != 0:
            logger.warning("Scheduler: morning_research_refresh exit %s", code)
            return False
    logger.info("Scheduler: morning research refresh OK")
    return True


def run_calendar_hot_zone_migrate(*, force: bool = False) -> bool:
    """Promote Calendar events ≤60d into Simulation sidecars for Wind / Catalyst."""
    global _last_hot_zone_migrate_date
    try:
        from calendar_hot_zone_migrate import run_calendar_hot_zone_migrate as _run

        result = _run(force=force)
        bump_desktop_manifest()
        logger.info("Scheduler: Calendar→Wind/Catalyst migrate %s", result)
        return bool(result.get("ok"))
    except Exception as exc:
        logger.warning("Scheduler: Calendar→Wind/Catalyst migrate failed: %s", exc)
        return False


def run_catalyst_desk_morning_cache(*, force: bool = False) -> bool:
    """Warm Catalyst morning columns (identity + Insider/Exec Exit + FDA Brief)."""
    global _last_desk_morning_cache_date
    try:
        from catalyst_desk_cache import run_morning_desk_cache_refresh

        result = run_morning_desk_cache_refresh(force=force)
        bump_desktop_manifest()
        logger.info("Scheduler: Catalyst morning desk cache %s", result)
        try:
            from competition_landscape_lookup import warm_desk_competition

            warm_desk_competition()
        except Exception as exc:
            logger.warning("Scheduler: competition warm skipped: %s", exc)
        return bool(result.get("ok") or result.get("events") is not None)
    except Exception as exc:
        logger.warning("Scheduler: Catalyst morning desk cache failed: %s", exc)
        return False


def run_catalyst_desk_hourly_cache(*, force: bool = False) -> bool:
    """Refresh Catalyst realtime columns (Vol/Sentiment/Skew/vs XBI/Pre-Mkt/Trends)."""
    global _last_desk_hourly_slot, _last_desk_hourly_date
    try:
        from catalyst_desk_cache import run_hourly_desk_cache_refresh

        result = run_hourly_desk_cache_refresh(force=force)
        bump_desktop_manifest()
        logger.info("Scheduler: Catalyst hourly desk cache %s", result)
        return True
    except Exception as exc:
        logger.warning("Scheduler: Catalyst hourly desk cache failed: %s", exc)
        return False


def run_daily_news_desk(*, force: bool = False) -> bool:
    """Catalyst Daily News search (09:00+) + migrate prior-hour items into company EIS."""
    global _last_daily_news_date, _last_daily_news_hour
    try:
        from daily_news_desk import run_daily_news_search

        result = run_daily_news_search(force=force)
        bump_desktop_manifest()
        logger.info("Scheduler: Daily News desk %s", result.get("ok") or result)
        return bool(result.get("ok", True))
    except Exception as exc:
        logger.warning("Scheduler: Daily News desk failed: %s", exc)
        return False


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


def run_fda_adcom_briefing_refresh(*, force: bool = False) -> bool:
    """FDA briefing cards → Daily News on first publish. Poll while due."""
    global _last_fda_briefing_date, _last_fda_briefing_at
    try:
        import fda_adcom_briefing as _fab

        result = _fab.run_fda_adcom_briefing_refresh(force=force)
        if result.get("error") == "already_running":
            return False
        _last_fda_briefing_date = date.today()
        _last_fda_briefing_at = datetime.now().astimezone()
        logger.info(
            "Scheduler: FDA briefing OK — %s cards ready · %s Daily News",
            result.get("briefings_ready", 0),
            result.get("daily_news_staged", 0),
        )
        return True
    except Exception:
        logger.exception("Scheduler: FDA briefing refresh failed")
        return False


def run_fda_adcom_calendar_refresh(*, force: bool = False) -> bool:
    """FDA AdCom 3-month window (NASDAQ names). 1st of each month."""
    global _last_fda_adcom_month
    try:
        import fda_adcom_calendar as _fac

        result = _fac.run_fda_adcom_calendar_refresh(force=force)
        if result.get("error") and result.get("error") not in {
            "federal_register_unavailable",
            "fda_search_unavailable",
            "live_unavailable",
        }:
            if result.get("error") == "already_running":
                return False
            logger.warning("Scheduler: FDA AdCom error: %s", result.get("error"))
            return False
        _last_fda_adcom_month = str(result.get("refreshed_for_month") or "")
        logger.info(
            "Scheduler: FDA AdCom OK — %s rows · %s → %s",
            result.get("count", 0),
            result.get("horizon_start"),
            result.get("horizon_end"),
        )
        return True
    except Exception:
        logger.exception("Scheduler: FDA AdCom refresh failed")
        return False


def run_universe_discovery_monthly(*, force: bool = False) -> bool:
    """Universe Discovery Screener — 2nd of each month (EDGAR full-text, outside watchlist)."""
    global _last_universe_discovery_month
    try:
        import universe_discovery as _ud

        if force:
            result = _ud.run_universe_discovery_refresh()
            if result.get("ok"):
                _ud.mark_monthly_run()
                result["scheduled_month"] = _ud.month_key()
        else:
            result = _ud.run_scheduled_universe_discovery()
        if result.get("error") == "already_running" or (
            not result.get("ok") and result.get("error") == "already_running"
        ):
            return False
        if not result.get("ok"):
            logger.warning("Scheduler: Universe Discovery error: %s", result.get("error"))
            return False
        _last_universe_discovery_month = str(
            result.get("scheduled_month") or _ud.month_key()
        )
        bump_desktop_manifest()
        logger.info(
            "Scheduler: Universe Discovery OK — %s new (A=%s B=%s) month=%s",
            result.get("count", 0),
            result.get("tier_a", 0),
            result.get("tier_b", 0),
            _last_universe_discovery_month,
        )
        return True
    except Exception:
        logger.exception("Scheduler: Universe Discovery refresh failed")
        return False


def run_guidance_calendar_refresh() -> bool:
    """Guidance Calendar extraction + catalyst sim-entries sync (weekly Monday / catch-up)."""
    global _last_guidance_cal_week
    try:
        import guidance_calendar as _gc
        result = _gc.run_guidance_calendar_refresh()
        if result.get("error"):
            logger.warning("Scheduler: guidance_calendar error: %s", result["error"])
            return False
        try:
            _gc.mark_weekly_run()
        except Exception:
            logger.exception("Scheduler: guidance_calendar weekly marker failed")
        _last_guidance_cal_week = _gc.last_weekly_week() or iso_week_key(date.today())
        bump_desktop_manifest()
        logger.info(
            "Scheduler: Guidance Calendar weekly OK — %d events, %d tickers, week=%s",
            result.get("count", 0),
            result.get("tickers_with_guidance", 0),
            _last_guidance_cal_week,
        )
        try:
            from catalyst_interest import refresh_interest_watchlist_catalysts

            interest = refresh_interest_watchlist_catalysts()
            logger.info(
                "Scheduler: interest watchlist catalysts OK — %s tickers, %s events",
                interest.get("updated"),
                interest.get("events_injected"),
            )
        except Exception:
            logger.exception("Scheduler: interest watchlist catalyst refresh failed")
        return True
    except Exception:
        logger.exception("Scheduler: guidance_calendar_refresh failed")
        return False


def run_ticker_8k_dossier_weekly() -> bool:
    """Wednesday morning: re-read last-2-month 8-Ks (per-Item summary + score)."""
    global _last_8k_dossier_week
    try:
        from ticker_8k_dossier import refresh_watchlist_8k_dossiers

        result = refresh_watchlist_8k_dossiers(force=True)
        _last_8k_dossier_week = iso_week_key(date.today())
        save_scheduler_state()
        bump_desktop_manifest()
        logger.info(
            "Scheduler: 8-K dossier weekly OK — tickers=%s refreshed=%s week=%s",
            result.get("tickers"),
            result.get("refreshed"),
            _last_8k_dossier_week,
        )
        return bool(result.get("ok"))
    except Exception:
        logger.exception("Scheduler: ticker 8-K dossier weekly failed")
        return False


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


def run_catalyst_short_interest_refresh(*, force: bool = False) -> bool:
    """Bi-monthly SI / DTC for the 10-day catalyst table. Once a day — not intra-day."""
    global _last_catalyst_si_date
    try:
        from catalyst_short_interest import refresh_catalyst_short_interest_universe

        out = refresh_catalyst_short_interest_universe(force=force)
        _last_catalyst_si_date = date.today()
        logger.info(
            "Scheduler: catalyst SI refresh OK rows=%s",
            len(out.get("rows") or {}),
        )
        return True
    except Exception:
        logger.exception("Scheduler: catalyst SI refresh failed")
        return False


def run_event_vol_refresh(*, force: bool = False) -> bool:
    """IV run-up + skew for catalysts in the next 10 days. Display only."""
    global _last_event_vol_date
    try:
        from event_vol_index import refresh_event_vol_universe

        out = refresh_event_vol_universe(force=force)
        _last_event_vol_date = date.today()
        logger.info(
            "Scheduler: event-vol refresh OK method=%s rows=%s",
            out.get("method"),
            len(out.get("rows") or {}),
        )
        return True
    except Exception:
        logger.exception("Scheduler: event-vol refresh failed")
        return False


def run_catalyst_uoa_refresh(*, force: bool = False) -> bool:
    """Daily Yahoo option-chain snapshot → build 20d AvgVol for UOA. Display only."""
    global _last_catalyst_uoa_date
    try:
        from catalyst_uoa import refresh_catalyst_uoa_universe

        out = refresh_catalyst_uoa_universe(force=force)
        _last_catalyst_uoa_date = date.today()
        logger.info(
            "Scheduler: catalyst UOA refresh OK rows=%s",
            len(out.get("rows") or {}),
        )
        return True
    except Exception:
        logger.exception("Scheduler: catalyst UOA refresh failed")
        return False


def run_trends_refresh(*, force: bool = True) -> bool:
    """Google Trends universe poll (early-warning index, not Soft BUY/SELL)."""
    try:
        from search_interest import refresh_search_interest_universe

        out = refresh_search_interest_universe(force=force)
        if not out.get("ok"):
            logger.warning(
                "Scheduler: Trends refresh skipped (%s)",
                out.get("error") or "unknown",
            )
            return False
        logger.info(
            "Scheduler: Trends refresh OK fetched=%s skipped=%s attempted=%s",
            out.get("fetched"),
            out.get("skipped_fresh"),
            out.get("attempted"),
        )
        return True
    except Exception:
        logger.exception("Scheduler: Trends refresh failed")
        return False


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


def _run_regulatory_risk_snapshot() -> None:
    """Build regulatory risk snapshot in-process.

    When catalyst_feed lags sec_k8 by ≥7d, optionally refreshes the feed first
    (``REGULATORY_RISK_REFRESH_CATALYST=1`` or default-on for weekday morning).
    """
    try:
        from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot

        snap = build_regulatory_risk_snapshot(refresh_catalyst_if_stale=True)
        save_snapshot(snap)
        logger.info("Scheduler: regulatory risk snapshot OK (%s signals)", snap.get("signal_count", 0))
    except Exception as exc:
        logger.warning("Scheduler: regulatory risk snapshot failed: %s", exc)


def _run_market_context_mcs_snapshot() -> None:
    """MCS benchmark series + 30d history (daily close signal)."""
    try:
        from prediction.market_context_score import (
            build_market_context_snapshot,
            load_previous_snapshot,
            save_market_context_snapshot,
        )

        prev = load_previous_snapshot()
        doc = build_market_context_snapshot(previous=prev)
        save_market_context_snapshot(doc)
        latest = doc.get("latest") or {}
        logger.info(
            "Scheduler: MCS snapshot OK status=%s mcs=%s",
            doc.get("update_status"),
            latest.get("mcs_global"),
        )
    except Exception as exc:
        logger.warning("Scheduler: MCS snapshot failed: %s", exc)


def _scheduler_loop(cfg: SupernovaConfig, stop: threading.Event) -> None:
    global _last_hourly_slot, _last_hourly_date, _last_morning_date, _last_hot_zone_migrate_date, _last_desk_morning_cache_date, _last_desk_hourly_slot, _last_desk_hourly_date, _last_sds_date, _last_daily_news_date, _last_daily_news_hour, _last_eis_date, _last_guidance_cal_week, _last_8k_dossier_week, _last_model_lab_date, _last_daily_run, _last_saturday_weekly_full_date, _last_trends_slot, _last_fda_adcom_month, _last_universe_discovery_month, _last_catalyst_calendar_month, _last_fda_briefing_date, _last_fda_briefing_at, _last_event_vol_date, _last_catalyst_si_date, _last_catalyst_uoa_date

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
    if cfg.trends_enabled:
        schedule_bits += ", Trends 3×/giorno (open) / 11:30+17:00 (chiuso)"
    schedule_bits += ", FDA AdCom 1° del mese 07:15 (3 mesi) + briefing T-2 07:45 + event-vol 08:15 + SI 08:20 (bi-mensile, non intra-day)"
    schedule_bits += ", Universe Discovery 2° del mese 07:30 → SEC Calendar (mensile)"

    logger.info(
        "Web scheduler avviato (poll %ss, tz=%s%s)",
        poll_sec,
        cfg.schedule_timezone,
        schedule_bits,
    )
    load_scheduler_state()
    boot_at = time.monotonic()

    legacy_interval_sec = max(60, cfg.scheduled_refresh_minutes * 60) if cfg.scheduled_refresh_minutes > 0 else 0
    last_legacy_live = 0.0

    while not stop.wait(timeout=poll_sec):
        # Let reconnecting desks read cache before in-process jobs (8-K,
        # Trends, Daily News) share this worker.
        if time.monotonic() - boot_at < _BOOT_GRACE_S:
            continue
        now_local = rome_now(tz_name=cfg.schedule_timezone)
        today = now_local.date()
        save_scheduler_state()

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

        # ── FDA AdCom calendar — 1st of the month, next 3 months ──
        try:
            from fda_adcom_calendar import should_run_fda_adcom_refresh

            if should_run_fda_adcom_refresh(now_local, last_month=_last_fda_adcom_month):
                run_fda_adcom_calendar_refresh()
                continue
        except Exception:
            logger.exception("Scheduler: FDA AdCom gate failed")

        # ── Universe Discovery — 2nd of the month (outside watchlist) ──
        try:
            import universe_discovery as _ud

            if _ud.should_run_universe_discovery_monthly(
                now_local, last_month=_last_universe_discovery_month
            ):
                run_universe_discovery_monthly()
                continue
        except Exception:
            logger.exception("Scheduler: Universe Discovery gate failed")

        # ── SEC Calendar monthly — 2nd ≥08:00 (Sim+Discovery full typology) ──
        try:
            import catalyst_calendar as _cc

            if _cc.should_run_catalyst_calendar_monthly(
                now_local, last_month=_last_catalyst_calendar_month
            ):
                if not _cc.get_status().get("running"):

                    def _cal_target() -> None:
                        global _last_catalyst_calendar_month
                        try:
                            _cc.run_catalyst_calendar_refresh()
                            _last_catalyst_calendar_month = (
                                f"{now_local.year:04d}-{now_local.month:02d}"
                            )
                        except Exception:
                            logger.exception("Scheduler: SEC Calendar monthly failed")

                    threading.Thread(
                        target=_cal_target, name="catalyst-calendar-monthly", daemon=True
                    ).start()
                continue
        except Exception:
            logger.exception("Scheduler: SEC Calendar monthly gate failed")

        try:
            from fda_adcom_briefing import should_run_fda_adcom_briefing

            if should_run_fda_adcom_briefing(
                now_local,
                last_run_at=_last_fda_briefing_at,
            ):
                run_fda_adcom_briefing_refresh()
        except Exception:
            logger.exception("Scheduler: FDA briefing gate failed")

        if (
            now_local.hour > 8 or (now_local.hour == 8 and now_local.minute >= 15)
        ) and _last_event_vol_date != today:
            run_event_vol_refresh()

        # Short interest is bi-monthly — one daily warm, never an hourly poll.
        if (
            now_local.hour > 8 or (now_local.hour == 8 and now_local.minute >= 20)
        ) and _last_catalyst_si_date != today:
            run_catalyst_short_interest_refresh()

        # UOA: one Yahoo chain snapshot / day to grow 20d AvgVol history.
        if (
            now_local.hour > 8 or (now_local.hour == 8 and now_local.minute >= 25)
        ) and _last_catalyst_uoa_date != today:
            run_catalyst_uoa_refresh()

        # ── Morning CD + IPO (priority) + regulatory risk snapshot ──
        if cfg.morning_refresh_enabled and should_run_morning_refresh(
            now_local,
            at=morning_at,
            last_date=_last_morning_date,
        ):
            run_morning_research_refresh()
            _run_regulatory_risk_snapshot()
            _run_market_context_mcs_snapshot()
            _last_morning_date = today
            continue

        # ── Calendar → Wind / Catalyst (≤2 months) — after morning research ──
        try:
            from calendar_hot_zone_migrate import due_for_morning_migrate

            if due_for_morning_migrate(
                now_local,
                last_date=_last_hot_zone_migrate_date,
                at_hour=morning_at.hour,
                at_minute=min(59, morning_at.minute + 5),
            ):
                run_calendar_hot_zone_migrate()
                _last_hot_zone_migrate_date = today
                continue
        except Exception as exc:
            logger.warning("Scheduler: hot-zone migrate gate failed: %s", exc)

        # ── Catalyst desk morning cache (identity + Insider/Exec/FDA Brief) ──
        try:
            from catalyst_desk_cache import due_for_morning_desk_cache

            if due_for_morning_desk_cache(
                now_local,
                last_date=_last_desk_morning_cache_date,
                at_hour=morning_at.hour,
                at_minute=min(59, morning_at.minute + 10),
            ):
                run_catalyst_desk_morning_cache()
                _last_desk_morning_cache_date = today
                continue
        except Exception as exc:
            logger.warning("Scheduler: Catalyst morning desk cache gate failed: %s", exc)

        # ── SDS full refresh (09:00 default) ──
        if cfg.sds_refresh_enabled and should_run_sds_refresh(
            now_local,
            at=sds_at,
            last_date=_last_sds_date,
        ):
            run_sds_cohort_refresh(mode="full")
            _last_sds_date = today
            # First Daily News search of the day (same 09:00 window).
            if run_daily_news_desk():
                _last_daily_news_date = today
                _last_daily_news_hour = now_local.hour
            continue

        # ── Daily News hourly (09:00–22:00 Rome weekdays) ──
        if (
            now_local.weekday() < 5
            and 9 <= now_local.hour <= 22
            and (
                _last_daily_news_date != today
                or _last_daily_news_hour != now_local.hour
            )
        ):
            if run_daily_news_desk():
                _last_daily_news_date = today
                _last_daily_news_hour = now_local.hour
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

        # ── Guidance Calendar (Monday ~10:30 + mid-week catch-up) ──
        if should_run_guidance_calendar_weekly(
            now_local,
            last_week=_last_guidance_cal_week,
            at=dt_time(10, 30),
        ):
            run_guidance_calendar_refresh()
            continue

        # ── 8-K Financial tab (Wednesday ~07:15 — last 2 months EDGAR digest) ──
        if should_run_8k_dossier_weekly(
            now_local,
            last_week=_last_8k_dossier_week,
            at=dt_time(7, 15),
        ):
            run_ticker_8k_dossier_weekly()
            continue

        # ── Hourly financial (15:30–22:00 IT) + Catalyst realtime columns ──
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
            # Same Nasdaq-open hourly window → Catalyst Vol/Sentiment/vs XBI/…
            if _last_desk_hourly_slot != int(slot) or _last_desk_hourly_date != today:
                if run_catalyst_desk_hourly_cache():
                    _last_desk_hourly_slot = int(slot)
                    _last_desk_hourly_date = today
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

        # ── Google Trends early-warning (3× open / 11:30+17:00 closed) ──
        if cfg.trends_enabled and should_run_trends_refresh(
            now_local,
            last_slot=_last_trends_slot,
        ):
            slot = trends_refresh_slot_id(now_local)
            if run_trends_refresh(force=True) and slot:
                _last_trends_slot = slot
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
    global _last_fda_adcom_month, _last_universe_discovery_month, _last_catalyst_calendar_month
    enabled = (
        cfg.hourly_financial_enabled
        or cfg.morning_refresh_enabled
        or cfg.sds_refresh_enabled
        or cfg.eis_refresh_enabled
        or cfg.model_lab_refresh_enabled
        or cfg.saturday_weekly_full_enabled
        or cfg.scheduled_refresh_minutes > 0
        or cfg.daily_refresh_hour >= 0
        or cfg.trends_enabled
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
    try:
        from competition_landscape_lookup import warm_desk_competition

        warm_desk_competition()
    except Exception as exc:
        logger.warning("competition warm at scheduler start skipped: %s", exc)
    if cfg.trends_enabled:
        threading.Thread(
            target=run_trends_refresh,
            kwargs={"force": False},
            daemon=True,
            name="trends-boot-warm",
        ).start()
    try:
        import fda_adcom_calendar as _fac_boot

        if not _fac_boot.snapshot_month_stale():
            _last_fda_adcom_month = str(
                (_fac_boot.load_snapshot() or {}).get("refreshed_for_month") or ""
            ) or None
    except Exception:
        logger.exception("Scheduler: FDA AdCom month init failed")
    try:
        import universe_discovery as _ud_boot

        _last_universe_discovery_month = _ud_boot.last_monthly_month()
        import catalyst_calendar as _cc_boot

        _last_catalyst_calendar_month = _cc_boot.last_monthly_month()
    except Exception:
        logger.exception("Scheduler: Universe Discovery month init failed")
    try:
        import guidance_calendar as _gc_boot

        _last_guidance_cal_week = _gc_boot.last_weekly_week()
        if not _last_guidance_cal_week:
            # Seed from snapshot if this week's refresh already ran before markers existed.
            snap = _gc_boot.load_snapshot()
            updated = str(snap.get("updated_at") or "")
            if updated:
                try:
                    from datetime import datetime as _dt

                    when = _dt.fromisoformat(updated.replace("Z", "+00:00")).astimezone()
                    snap_week = iso_week_key(when.date())
                    if snap_week == iso_week_key(date.today()):
                        _gc_boot.mark_weekly_run(snap_week)
                        _last_guidance_cal_week = snap_week
                except Exception:
                    pass
    except Exception:
        logger.exception("Scheduler: Guidance Calendar week init failed")
    threading.Thread(
        target=_boot_fda_adcom_if_stale,
        daemon=True,
        name="fda-adcom-boot-warm",
    ).start()
    threading.Thread(
        target=_boot_fda_briefing_if_due,
        daemon=True,
        name="fda-adcom-briefing-boot",
    ).start()
    threading.Thread(
        target=_boot_universe_discovery_if_due,
        daemon=True,
        name="universe-discovery-boot",
    ).start()
    return stop


def _boot_fda_adcom_if_stale() -> None:
    """Catch-up if this month's 3-month window was never written."""
    try:
        import fda_adcom_calendar as _fac

        if _fac.snapshot_month_stale():
            run_fda_adcom_calendar_refresh(force=True)
    except Exception:
        logger.exception("Scheduler: FDA AdCom boot refresh failed")


def _boot_fda_briefing_if_due() -> None:
    """Catch-up if a meeting is inside the T-2 window without a briefing card."""
    try:
        import fda_adcom_briefing as _fab

        if _fab.any_due_without_card():
            run_fda_adcom_briefing_refresh(force=True)
    except Exception:
        logger.exception("Scheduler: FDA briefing boot refresh failed")


def _boot_universe_discovery_if_due() -> None:
    """Catch-up on the 2nd if this month's Discovery scan never ran."""
    try:
        import universe_discovery as _ud
        from supernova_schedule import rome_now

        now = rome_now()
        if _ud.should_run_universe_discovery_monthly(now):
            run_universe_discovery_monthly()
    except Exception:
        logger.exception("Scheduler: Universe Discovery boot refresh failed")


__all__ = [
    "bump_desktop_manifest",
    "run_daily_market_refresh",
    "run_hourly_financial_refresh",
    "run_hourly_live_refresh",
    "run_morning_research_refresh",
    "run_calendar_hot_zone_migrate",
    "run_catalyst_desk_morning_cache",
    "run_catalyst_desk_hourly_cache",
    "run_daily_news_desk",
    "run_sds_cohort_refresh",
    "run_eis_morning_refresh",
    "run_fda_adcom_calendar_refresh",
    "run_fda_adcom_briefing_refresh",
    "run_universe_discovery_monthly",
    "run_guidance_calendar_refresh",
    "run_event_vol_refresh",
    "run_catalyst_short_interest_refresh",
    "run_catalyst_uoa_refresh",
    "run_model_lab_accuracy_refresh",
    "run_saturday_weekly_full_refresh",
    "run_trends_refresh",
    "start_web_scheduler",
]
