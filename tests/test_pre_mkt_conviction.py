"""Unit tests for Pre-Mkt Conviction formulas (proxy — not official imbalance)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

import pre_mkt_conviction as pmc

NY = ZoneInfo("America/New_York")


@pytest.fixture(autouse=True)
def _clean():
    pmc.clear_cache_for_tests()
    yield
    pmc.clear_cache_for_tests()


def test_price_change_pct():
    assert pmc.pre_mkt_price_change_pct(10.21, 10.0) == pytest.approx(2.1)
    assert pmc.pre_mkt_price_change_pct(9.5, 10.0) == pytest.approx(-5.0)
    assert pmc.pre_mkt_price_change_pct(10, 0) is None


def test_vol_ratio():
    assert pmc.pre_mkt_vol_ratio(230_000, 100_000) == pytest.approx(2.3)
    assert pmc.pre_mkt_vol_ratio(50, 0) is None


def test_classify_together_and_diverge():
    assert pmc.classify_pre_mkt_conviction(2.1, 2.3) == "together_up"
    assert pmc.classify_pre_mkt_conviction(-1.5, 2.0) == "together_down"
    assert pmc.classify_pre_mkt_conviction(2.1, 1.2) == "diverge"
    assert pmc.classify_pre_mkt_conviction(None, 2.0) is None


def test_conviction_confirmed_requires_same_day_buzz():
    assert pmc.compute_conviction_confirmed("together_up", 12.0) is True
    assert pmc.compute_conviction_confirmed("together_up", -5.0) is False
    assert pmc.compute_conviction_confirmed("together_down", -8.0) is True
    assert pmc.compute_conviction_confirmed("together_up", None) is None
    assert pmc.compute_conviction_confirmed("diverge", 10.0) is False


def test_build_row_badge_fields():
    row = pmc.build_row(
        "ETON",
        pre_mkt_last=10.21,
        prior_close=10.0,
        pre_mkt_volume=230_000,
        pre_mkt_volume_avg_20d=100_000,
        search_buzz_delta_pct=15.0,
        asof_et=datetime(2026, 9, 8, 9, 15, tzinfo=NY),
    )
    assert row["is_proxy"] is True
    assert row["index_kind"] == "pre_mkt_conviction_proxy"
    assert row["conviction"] == "together_up"
    assert row["pre_mkt_price_change_pct"] == pytest.approx(2.1)
    assert row["pre_mkt_vol_ratio"] == pytest.approx(2.3)
    assert row["conviction_confirmed"] is True


def test_build_row_price_only_without_volume():
    """Yahoo chart Volume is often 0 in premkt — still show diverge from price."""
    row = pmc.build_row(
        "AAPL",
        pre_mkt_last=328.3,
        prior_close=327.0,
        pre_mkt_volume=0,
        pre_mkt_volume_avg_20d=None,
        asof_et=datetime(2026, 9, 4, 9, 15, tzinfo=NY),
    )
    assert row["status"] == "ok"
    assert row["conviction"] == "diverge"
    assert row["pre_mkt_vol_ratio"] is None
    assert row["pre_mkt_price_change_pct"] is not None


def test_no_trades_blank():
    row = pmc.build_row(
        "ETON",
        pre_mkt_last=None,
        prior_close=10.0,
        pre_mkt_volume=0,
        pre_mkt_volume_avg_20d=100_000,
    )
    assert row["status"] == "no_premarket_trades"
    assert row["conviction"] is None


def test_session_volume_aggregation():
    ts = [
        datetime(2026, 9, 5, 8, 0, tzinfo=NY),
        datetime(2026, 9, 5, 9, 0, tzinfo=NY),
        datetime(2026, 9, 8, 8, 30, tzinfo=NY),
        datetime(2026, 9, 8, 10, 0, tzinfo=NY),  # RTH — ignore
    ]
    vols = [50_000, 50_000, 80_000, 999_000]
    closes = [9.5, 9.6, 10.2, 10.5]
    today_vol, today_last, _, prior, latest = pmc._session_volumes_from_bars(
        ts, vols, closes, today=__import__("datetime").date(2026, 9, 8)
    )
    assert today_vol == 80_000
    assert today_last == 10.2
    assert prior == [100_000]
    assert latest is not None
    assert latest["date"].isoformat() == "2026-09-08"
    assert latest["last"] == 10.2


def test_session_zero_volume_still_keeps_last_price():
    ts = [datetime(2026, 9, 4, 8, 0, tzinfo=NY)]
    vols = [0.0]
    closes = [12.5]
    today_vol, today_last, _, prior, latest = pmc._session_volumes_from_bars(
        ts, vols, closes, today=__import__("datetime").date(2026, 9, 4)
    )
    assert today_vol is None
    assert today_last == 12.5
    assert prior == []
    assert latest is not None and latest["vol"] is None


def test_naming_not_order_imbalance():
    out = pmc.fetch_pre_mkt_conviction([], now=datetime(2026, 9, 8, 8, 0, tzinfo=NY))
    assert out["is_proxy"] is True
    assert out["paid_dependency"] is False
    assert "imbalance" not in (out.get("index_kind") or "").lower()
    assert "proxy" in (out.get("note") or "").lower()
