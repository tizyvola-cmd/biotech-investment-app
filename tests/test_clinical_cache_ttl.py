"""TTL helpers for clinical enrichment cache."""
from datetime import datetime, timedelta, timezone

from clinical_cache_ttl import (
    CLINICAL_CACHE_TTL_DAYS,
    is_cache_fresh,
    needs_scheduled_deep_refresh,
    should_skip_enrichment_refresh,
    study_clinical_profile_is_sparse,
)


def _rec(days_ago: float, **extra):
    ts = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
    return {"enriched_at": ts, "ai_ok": True, **extra}


def _rich_ai():
    return {
        "study_clinical_profile": {
            "mechanism_of_action": "WEE1 kinase inhibitor",
            "disease_soc": {
                "usa_prevalence": "~20k new US cases/yr",
                "soc_name": "PLD / topotecan",
                "soc_efficacy_benchmark": "ORR ~20–30%",
                "life_expectancy": "median OS ~12 mo",
                "symptoms": "abdominal pain, bloating",
            },
        }
    }


def test_fresh_within_ttl():
    assert is_cache_fresh(_rec(5)) is True


def test_stale_beyond_ttl():
    assert is_cache_fresh(_rec(CLINICAL_CACHE_TTL_DAYS + 2)) is False


def test_skip_refresh_when_fresh_and_rich():
    assert (
        should_skip_enrichment_refresh(_rec(3, ai=_rich_ai()), force=False, deep=False) is True
    )


def test_no_skip_when_profile_sparse_even_if_fresh():
    sparse = _rec(
        3,
        ai={
            "study_clinical_profile": {
                "disease_soc": {
                    "disease": "ovarian cancer",
                    "source_note": "long prose only",
                }
            }
        },
    )
    assert study_clinical_profile_is_sparse(sparse["ai"]) is True
    assert should_skip_enrichment_refresh(sparse, force=False, deep=False) is False


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
