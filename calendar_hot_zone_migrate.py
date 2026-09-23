"""
Morning Calendar → Wind / Catalyst hot-zone promote
===================================================
Promote newly dated Calendar events (SEC forward + Guidance CD) with a
deadline within ~2 months into the Simulation sidecars that Wind Evolution
and Catalyst desk read.

Does **not** change Soft BUY/SELL gates.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("supernova.calendar_hot_zone_migrate")

# Align with desktop ``SIM_HOT_ZONE_DAYS`` / Wind + Catalyst membership.
HOT_ZONE_DAYS = 60


def _parse_iso(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _within_hot_zone(d: date | None, today: date | None = None) -> bool:
    if d is None:
        return False
    ref = today or date.today()
    delta = (d - ref).days
    return 0 <= delta <= HOT_ZONE_DAYS


def run_calendar_hot_zone_migrate(*, force: bool = False) -> dict[str, Any]:
    """
    Daily promote: Calendar events ≤60d → Simulation sidecars for Wind / Catalyst.

    1. SEC catalyst calendar → ``discovery_catalyst_sim_entries`` (horizon 60).
    2. Guidance calendar snapshot → ``catalyst_sim_entries`` (nearest future CD).
    """
    today = date.today()
    out: dict[str, Any] = {
        "ok": False,
        "horizon_days": HOT_ZONE_DAYS,
        "sec_promoted": 0,
        "guidance_entries": 0,
        "guidance_hot": 0,
        "error": None,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        from universe_discovery import sync_near_catalyst_sim_entries

        sec = sync_near_catalyst_sim_entries(horizon_days=HOT_ZONE_DAYS)
        out["sec_promoted"] = int(sec.get("entries") or sec.get("written") or sec.get("count") or 0)
        out["sec_synced"] = int(sec.get("synced") or 0)
        out["sec_result"] = {
            k: sec.get(k)
            for k in ("entries", "synced", "horizon_days")
            if k in sec
        }
    except Exception as exc:
        logger.warning("hot-zone SEC promote failed: %s", exc)
        out["error"] = f"sec:{exc}"

    try:
        from guidance_calendar import load_snapshot, write_catalyst_sim_entries

        snap = load_snapshot()
        events = [e for e in (snap.get("events") or []) if isinstance(e, dict)]
        hot = 0
        for ev in events:
            start = _parse_iso(ev.get("window_start") or ev.get("window_end"))
            end = _parse_iso(ev.get("window_end") or ev.get("window_start"))
            if _within_hot_zone(start, today) or _within_hot_zone(end, today):
                hot += 1
        out["guidance_hot"] = hot
        cat = write_catalyst_sim_entries(events)
        out["guidance_entries"] = int(cat.get("entries") or 0)
        out["guidance_synced"] = int(cat.get("synced") or 0)
    except Exception as exc:
        logger.warning("hot-zone guidance promote failed: %s", exc)
        if out["error"]:
            out["error"] = f"{out['error']}; guidance:{exc}"
        else:
            out["error"] = f"guidance:{exc}"

    out["ok"] = out["error"] is None
    logger.info(
        "Calendar→Wind/Catalyst migrate: sec=%s guidance_hot=%s/%s ok=%s",
        out.get("sec_promoted"),
        out.get("guidance_hot"),
        out.get("guidance_entries"),
        out["ok"],
    )
    return out


def due_for_morning_migrate(
    now_local: datetime,
    *,
    last_date: date | None,
    at_hour: int = 7,
    at_minute: int = 5,
    force: bool = False,
) -> bool:
    """True once per Mon–Fri after ``at_hour:at_minute`` Rome local."""
    if force:
        return last_date != now_local.date()
    if now_local.weekday() >= 5:
        return False
    today = now_local.date()
    if last_date == today:
        return False
    return (now_local.hour, now_local.minute) >= (at_hour, at_minute)
