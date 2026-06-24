"""Cluster E (timing) component tests."""
from __future__ import annotations

from prediction.supernova_score import (
    SdsTickerInput,
    catalyst_quality_modifier,
    catalyst_window_detail,
    compute_cluster_e,
    sequential_catalyst_detail,
)


def test_catalyst_window_optimal():
    d = catalyst_window_detail(25, cd_date="2026-06-01")
    assert d["score"] == 6.0
    assert d["flag"] == "OPTIMAL"


def test_catalyst_window_binary_zone():
    d = catalyst_window_detail(5)
    assert d["score"] == 2.0
    assert d["flag"] == "BINARY_EVENT_LOCK"


def test_catalyst_window_cd_passed():
    d = catalyst_window_detail(-30)
    assert d["score"] == 0.0
    assert d["flag"] == "CD_PASSED"


def test_catalyst_window_simulation_watch_bands():
    """61–120d aligned with Simulation CD watch (4–2 mo)."""
    d82 = catalyst_window_detail(82)
    assert d82["score"] == 3.0
    assert d82["flag"] == "EARLY_WATCH"
    d110 = catalyst_window_detail(110)
    assert d110["score"] == 2.5
    assert d110["flag"] == "MONITOR"
    d130 = catalyst_window_detail(130)
    assert d130["score"] == 0.0
    assert d130["flag"] == "DISTANT"


def test_sequential_catalyst_max_four():
    d = sequential_catalyst_detail(["clinical_readout", "conference", "regulatory", "financial"])
    assert d["score"] == 4.0
    assert d["max"] == 4


def test_sequential_two_types():
    d = sequential_catalyst_detail(["clinical_readout", "analyst_event"])
    assert d["score"] == 2.0
    assert d["catalyst_count"] == 2


def test_quality_modifier_boosts_window():
    mod = catalyst_quality_modifier(0.65, 6.0)
    assert mod == 0.5
    _, bd = compute_cluster_e(
        SdsTickerInput(
            ticker="T",
            days_to_cd=25,
            phase_probability=0.65,
            pred5_live=6.0,
            catalyst_types_90d=["clinical_readout", "conference"],
        )
    )
    assert bd["catalyst_window"]["score"] == 6.0  # capped at 6
    assert bd["sequential_catalysts"]["score"] == 2.0
    assert bd["total"] == 8.0
    assert bd["flags"]["optimal_window"] is True


def test_binary_event_flag():
    _, bd = compute_cluster_e(SdsTickerInput(ticker="T", days_to_cd=3))
    assert bd["flags"]["binary_event_lock"] is True
    assert bd["catalyst_window"]["score"] == 2.0
