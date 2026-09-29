"""Catalyst benchmark calendar gate + importance matching."""
from __future__ import annotations

import pytest

from catalyst_benchmark import (
    clear_catalyst_benchmark_cache,
    importance_for_taxonomy,
    is_calendar_catalyst,
    is_conference_text,
    list_benchmark_events,
    match_benchmark_event,
    scheduled_search_queries,
)


def setup_function() -> None:
    clear_catalyst_benchmark_cache()


def test_benchmark_loads_excel_seed() -> None:
    events = list_benchmark_events()
    assert len(events) >= 70
    scheduled = list_benchmark_events(scheduled_only=True)
    assert len(scheduled) >= 20
    assert any("Phase 3 topline primary endpoint MET" in e["label"] for e in events)


def test_outcome_specific_importance() -> None:
    met = match_benchmark_event(
        "Phase 3 pivotal topline primary endpoint met registrational",
        taxonomy_event_id="CLIN_PRIMARY_MET",
    )
    assert met is not None
    assert float(met["importance_score"]) == pytest.approx(0.85)
    
    missed = match_benchmark_event(
        "Phase 3 topline primary endpoint missed failed",
        taxonomy_event_id="CLIN_PRIMARY_MISSED",
    )
    assert missed is not None
    assert float(missed["importance_score"]) == pytest.approx(-0.75)

    assert importance_for_taxonomy(
        "CLIN_PRIMARY_MISSED",
        text="Phase 2 topline negative missed endpoint",
    ) == pytest.approx(-0.5)


def test_calendar_requires_future_catalyst_or_conference() -> None:
    assert is_conference_text("Company to present at ASCO 2026", event_type="conference")
    assert is_calendar_catalyst(
        text="PDUFA date set for NDA review",
        event_type="pdufa",
        timing_quote="PDUFA June 2027",
    )
    assert is_calendar_catalyst(
        text="Will present at Jefferies Healthcare Conference",
        event_type="conference",
        timing_quote="June 5, 2027",
    )
    # Pure earnings without scheduled catalyst wording should not calendar-inject
    # via generic 'other' unless benchmark scheduled earnings/revenue match.
    assert not is_calendar_catalyst(
        text="CEO quotes favorite restaurant",
        event_type="other",
        timing_quote="nice weather",
    )


def test_scheduled_search_queries_include_company_and_event() -> None:
    qs = scheduled_search_queries("SeaStar Medical", "ICU", limit=4)
    assert qs
    assert any("ICU" in q and ("Phase" in q or "PDUFA" in q or "ASCO" in q) for q in qs)
