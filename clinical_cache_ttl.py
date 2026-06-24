"""
Shared TTL helpers for clinical AI caches (summaries + pre-CD enrichment).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

CLINICAL_CACHE_TTL_DAYS = int(os.environ.get("CLINICAL_CACHE_TTL_DAYS", "30"))
CLINICAL_DEEP_REFRESH_DAYS = int(os.environ.get("CLINICAL_DEEP_REFRESH_DAYS", "7"))


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not str(ts).strip():
        return None
    s = str(ts).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def cache_age_days(entry: dict[str, Any], *ts_keys: str) -> float | None:
    """Age in days from the newest timestamp among ``ts_keys`` (default enriched/generated)."""
    keys = ts_keys or ("enriched_at", "generated_at", "cached_at", "updated_at")
    best: datetime | None = None
    for k in keys:
        dt = _parse_iso(str(entry.get(k) or ""))
        if dt and (best is None or dt > best):
            best = dt
    if best is None:
        return None
    return (datetime.now(timezone.utc) - best).total_seconds() / 86400.0


def is_cache_fresh(
    entry: dict[str, Any],
    *,
    ttl_days: int | None = None,
    ts_keys: tuple[str, ...] = ("enriched_at", "generated_at"),
) -> bool:
    ttl = ttl_days if ttl_days is not None else CLINICAL_CACHE_TTL_DAYS
    age = cache_age_days(entry, *ts_keys)
    if age is None:
        return False
    return age < float(ttl)


def ctgov_update_newer_than_enrichment(rec: dict[str, Any]) -> bool:
    """True when CT.gov last_update is after our last enrichment (new data posted)."""
    enriched = _parse_iso(str(rec.get("enriched_at") or ""))
    ct_up = _parse_iso(str(rec.get("last_ctgov_update") or ""))
    if not enriched or not ct_up:
        return False
    return ct_up > enriched


def should_skip_enrichment_refresh(
    prev: dict[str, Any] | None,
    *,
    force: bool = False,
    deep: bool = False,
) -> bool:
    """
    Skip expensive AI+fetch when snapshot row is fresh and complete.
    Never skip on force/deep or when CT.gov posted updates after enrichment.
    """
    if force or deep or not prev:
        return False
    if ctgov_update_newer_than_enrichment(prev):
        return False
    try:
        import ai_provider

        ai = prev.get("ai")
        if isinstance(ai, dict) and ai_provider.is_stale_extraction(ai):
            return False
    except Exception:
        pass
    if not prev.get("ai_ok"):
        return False
    return is_cache_fresh(prev)


def needs_scheduled_deep_refresh(prev: dict[str, Any] | None) -> bool:
    """Portfolio deep Copilot pass — default every 7 days per study."""
    if not prev:
        return True
    age = cache_age_days(prev, "deep_enriched_at", "enriched_at")
    if age is None:
        return True
    return age >= float(CLINICAL_DEEP_REFRESH_DAYS)
