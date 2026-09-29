"""Per-ticker VOL % cache — KPI must not re-hit Yahoo when the list changes."""
from __future__ import annotations

from market_volume_history import (
    _vs_prev_row_from_ohlcv_bars,
    clear_volume_vs_prev_cache,
    obv_divergence_flag,
    partition_vs_prev_cache,
    volume_delta_signed,
)


def _complete_row(pct: float) -> dict:
    return {
        "pct_of_prev": pct,
        "last_close": 10.0,
        "prev_close": 9.8,
        "volume": 1000,
        "prev_volume": 800,
        "date": "2026-09-04",
        "prev_date": "2026-09-03",
    }


def test_partition_reuses_fresh_tickers_when_the_batch_changes():
    store = {
        "ZNTL": {"at": 100.0, "row": _complete_row(88.0)},
        "BBNX": {"at": 100.0, "row": _complete_row(120.0)},
    }
    fresh, stale = partition_vs_prev_cache(
        ["ZNTL", "NRIX"],
        now=100.0 + 60,
        ttl_s=300,
        store=store,
    )
    assert fresh["ZNTL"]["pct_of_prev"] == 88.0
    assert stale == ["NRIX"]


def test_partition_treats_volume_without_price_as_stale():
    store = {"ZNTL": {"at": 100.0, "row": {"pct_of_prev": 88.0, "volume": 1000}}}
    fresh, stale = partition_vs_prev_cache(
        ["ZNTL"],
        now=100.0 + 10,
        ttl_s=300,
        store=store,
    )
    assert fresh == {}
    assert stale == ["ZNTL"]


def test_vs_prev_row_from_ohlcv_bars_includes_closes():
    row = _vs_prev_row_from_ohlcv_bars(
        [
            {"date": "2026-09-03", "close": 9.8, "volume": 800_000},
            {"date": "2026-09-04", "close": 10.3, "volume": 1_200_000},
        ]
    )
    assert row is not None
    assert row["pct_of_prev"] == 150.0
    assert row["last_close"] == 10.3
    assert row["prev_close"] == 9.8
    assert row["volume_delta_signed"] == 1_200_000


def test_partition_treats_expired_and_force_as_stale():
    store = {"ZNTL": {"at": 100.0, "row": _complete_row(88.0)}}
    expired, expired_stale = partition_vs_prev_cache(
        ["ZNTL"],
        now=100.0 + 301,
        ttl_s=300,
        store=store,
    )
    assert expired == {}
    assert expired_stale == ["ZNTL"]

    forced, forced_stale = partition_vs_prev_cache(
        ["ZNTL"],
        now=100.0 + 10,
        force=True,
        ttl_s=300,
        store=store,
    )
    assert forced == {}
    assert forced_stale == ["ZNTL"]


def test_volume_delta_signed_down_bar_is_distribution():
    """CANF-style: high volume on a down close is negative (sale), not accumulation."""
    assert volume_delta_signed(1.10, 1.40, 419_000) == -419_000
    assert volume_delta_signed(1.50, 1.40, 200_000) == 200_000
    assert volume_delta_signed(1.40, 1.40, 100_000) == 0.0
    assert volume_delta_signed(None, 1.40, 100_000) is None


def test_obv_divergence_flag_net_price_up_heavy_down_volume():
    days = [
        ("2026-09-01", 100.0),
        ("2026-09-02", 100.0),
        ("2026-09-03", 10_000.0),
        ("2026-09-04", 100.0),
    ]
    closes = {
        "2026-09-01": 10.0,
        "2026-09-02": 10.2,
        "2026-09-03": 10.1,
        "2026-09-04": 10.3,
    }
    assert obv_divergence_flag(days, closes) is True
    aligned = {
        "2026-09-01": 10.0,
        "2026-09-02": 10.2,
        "2026-09-03": 10.4,
        "2026-09-04": 10.6,
    }
    assert obv_divergence_flag(days, aligned) is False


def test_clear_volume_vs_prev_cache_empties_module_store():
    clear_volume_vs_prev_cache()
    fresh, stale = partition_vs_prev_cache(["ZNTL"], now=1.0)
    assert fresh == {}
    assert stale == ["ZNTL"]
