"""Unit tests for Pre-Open Imbalance formulas, windows, and no-stale policy."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

import pre_open_imbalance as poi

NY = ZoneInfo("America/New_York")


def _et(h: int, m: int, s: int = 0, day: int = 8) -> datetime:
    # 2026-09-08 Monday
    return datetime(2026, 9, day, h, m, s, tzinfo=NY)


@pytest.fixture(autouse=True)
def _clean():
    poi.clear_session_cache_for_tests()
    yield
    poi.clear_session_cache_for_tests()


def test_imbalance_ratio():
    assert poi.imbalance_ratio(30_000, 100_000) == 0.3
    assert poi.imbalance_ratio(10, 0) is None
    assert poi.imbalance_ratio(None, 100) is None


def test_indicative_move_pct():
    assert poi.indicative_move_pct(10.32, 10.0) == pytest.approx(3.2)
    assert poi.indicative_move_pct(9.7, 10.0) == pytest.approx(-3.0)
    assert poi.indicative_move_pct(10, 0) is None


def test_direction_from_side():
    assert poi.imbalance_direction_from_side("B") == "Buy"
    assert poi.imbalance_direction_from_side("A") == "Sell"
    assert poi.imbalance_direction_from_side("N") is None


def test_listing_routing_never_defaults_nasdaq():
    assert poi.dataset_for_listing("NASDAQ").dataset == "XNAS.ITCH"
    assert poi.dataset_for_listing("NYSE").dataset == "XNYS.PILLAR"
    assert poi.dataset_for_listing(None) is None
    assert poi.dataset_for_listing("UNKNOWN_MIC") is None


def test_nasdaq_window_only_928_930():
    route = poi.dataset_for_listing("NASDAQ")
    assert route is not None
    assert poi.is_in_transmission_window(route, _et(9, 27, 59)) is False
    assert poi.is_in_transmission_window(route, _et(9, 28, 0)) is True
    assert poi.is_in_transmission_window(route, _et(9, 29, 59)) is True
    assert poi.is_in_transmission_window(route, _et(9, 30, 0)) is False


def test_nyse_window_900_930():
    route = poi.dataset_for_listing("NYSE")
    assert route is not None
    assert poi.is_in_transmission_window(route, _et(8, 59, 59)) is False
    assert poi.is_in_transmission_window(route, _et(9, 0, 0)) is True
    assert poi.is_in_transmission_window(route, _et(9, 29, 30)) is True
    assert poi.is_in_transmission_window(route, _et(9, 30, 0)) is False


def test_accelerating_requires_two_snapshots_same_direction():
    snaps = [
        {
            "et": _et(9, 28, 10),
            "imbalance_ratio": 0.4,
            "direction": "Buy",
        },
        {
            "et": _et(9, 29, 20),
            "imbalance_ratio": 0.55,
            "direction": "Buy",
        },
    ]
    assert poi.imbalance_accelerating(snaps) is True

    snaps_down = [
        {**snaps[0]},
        {"et": _et(9, 29, 20), "imbalance_ratio": 0.2, "direction": "Buy"},
    ]
    assert poi.imbalance_accelerating(snaps_down) is False

    assert poi.imbalance_accelerating([snaps[0]]) is None


def test_accelerating_false_when_direction_flips():
    snaps = [
        {"et": _et(9, 28, 10), "imbalance_ratio": 0.4, "direction": "Buy"},
        {"et": _et(9, 29, 20), "imbalance_ratio": 0.9, "direction": "Sell"},
    ]
    assert poi.imbalance_accelerating(snaps) is False


def test_outside_window_never_returns_stale_values():
    route = poi.dataset_for_listing("NASDAQ")
    assert route is not None
    # Inject a print, then query after the window — must blank.
    poi.remember_snapshot(
        "ETON",
        {
            "et": _et(9, 29, 0),
            "imbalance_shares": 50_000,
            "paired_shares": 100_000,
            "imbalance_ratio": 0.5,
            "indicative_match_price": 10.5,
            "direction": "Buy",
        },
    )
    out = poi.fetch_pre_open_imbalance(
        ["ETON"],
        listing_by_ticker={"ETON": "NASDAQ"},
        prior_close_by_ticker={"ETON": 10.0},
        now=_et(9, 35, 0),
    )
    row = out["rows"]["ETON"]
    assert row["status"] == "outside_window"
    assert row["direction"] is None
    assert row["imbalance_ratio"] is None
    assert row["indicative_move_pct"] is None
    assert row["imbalance_shares"] is None


def test_in_window_builds_badge_fields():
    poi.remember_snapshot(
        "ETON",
        {
            "et": _et(9, 28, 5),
            "imbalance_shares": 20_000,
            "paired_shares": 100_000,
            "imbalance_ratio": 0.2,
            "indicative_match_price": 10.1,
            "direction": "Buy",
        },
    )
    poi.remember_snapshot(
        "ETON",
        {
            "et": _et(9, 29, 10),
            "imbalance_shares": 40_000,
            "paired_shares": 100_000,
            "imbalance_ratio": 0.4,
            "indicative_match_price": 10.32,
            "direction": "Buy",
        },
    )
    out = poi.fetch_pre_open_imbalance(
        ["ETON"],
        listing_by_ticker={"ETON": "NASDAQ"},
        prior_close_by_ticker={"ETON": 10.0},
        now=_et(9, 29, 30),
    )
    row = out["rows"]["ETON"]
    assert row["in_window"] is True
    assert row["direction"] == "Buy"
    assert row["imbalance_ratio"] == 0.4
    assert row["indicative_move_pct"] == pytest.approx(3.2)
    assert row["imbalance_accelerating"] is True
    assert row["imbalance_shares"] == 40_000
    assert out["continuous_refresh"] is False


def test_unknown_listing_does_not_assume_nasdaq():
    out = poi.fetch_pre_open_imbalance(
        ["ZZZZ"],
        listing_by_ticker={},
        now=_et(9, 29, 0),
    )
    assert out["rows"]["ZZZZ"]["status"] == "unknown_listing_venue"
    assert out["rows"]["ZZZZ"]["dataset"] is None
