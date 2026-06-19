"""TTL helpers for clinical enrichment cache."""
from datetime import datetime, timedelta, timezone

from clinical_cache_ttl import (
    CLINICAL_CACHE_TTL_DAYS,
    is_cache_fresh,
    needs_scheduled_deep_refresh,
    should_skip_enrichment_refresh,
)


def _rec(days_ago: float, **extra):
    ts = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    return {"enriched_at": ts, "ai_ok": True, **extra}


def test_fresh_within_ttl():
    assert is_cache_fresh(_rec(5)) is True


def test_stale_beyond_ttl():
    assert is_cache_fresh(_rec(CLINICAL_CACHE_TTL_DAYS + 2)) is False


def test_skip_refresh_when_fresh():
    assert should_skip_enrichment_refresh(_rec(3), force=False, deep=False) is True


def test_no_skip_on_force_or_deep():
    assert should_skip_enrichment_refresh(_rec(3), force=True, deep=False) is False
    assert should_skip_enrichment_refresh(_rec(3), force=False, deep=True) is False


def test_no_skip_when_ctgov_updated_after_enrichment():
    prev = _rec(
        2,
        last_ctgov_update=(datetime.now(timezone.utc) - timedelta(days=0)).isoformat(),
    )
    assert should_skip_enrichment_refresh(prev, force=False, deep=False) is False


def test_scheduled_deep_after_week():
    assert needs_scheduled_deep_refresh(_rec(10)) is True
    assert needs_scheduled_deep_refresh(_rec(2, deep_enriched_at=_rec(2)["enriched_at"])) is False
