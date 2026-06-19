"""Cluster C (price structure) component tests."""
from __future__ import annotations

import math

from prediction.supernova_score import (
    SdsTickerInput,
    bb_squeeze_score,
    bollinger_squeeze_detail,
    compute_cluster_c,
    obv_accumulation_score,
    volume_ratio_component_score,
    xbi_rs_90d_score,
)


def _flat_closes(n: int, price: float = 10.0, jitter: float = 0.0) -> list[float]:
    return [price + (i % 3) * jitter for i in range(n)]


def _trend_closes(n: int, start: float = 10.0, step: float = 0.05) -> list[float]:
    return [start + i * step for i in range(n)]


def test_bb_squeeze_low_percentile_scores_high():
    closes = _flat_closes(150, price=10.0, jitter=0.01)
    score, pct, miss = bb_squeeze_score(closes)
    assert miss is None
    assert pct is not None
    assert pct <= 50
    assert score >= 2.0


def test_bb_squeeze_insufficient_history():
    score, pct, miss = bb_squeeze_score(_flat_closes(50))
    assert score == 0.0
    assert pct is None
    assert miss == "insufficient_history"


def test_obv_accumulation_flat_price_rising_obv():
    closes = [10.0 + (0.02 if i % 4 == 0 else 0.0) for i in range(25)]
    volumes = [1_000_000.0 + i * 50_000 for i in range(25)]
    score, miss = obv_accumulation_score(closes, volumes)
    assert miss is None
    assert score in (5.0, 6.0, 8.0)
    assert score > 0


def test_obv_accumulation_insufficient_history():
    score, miss = obv_accumulation_score(_flat_closes(10), [1.0] * 10)
    assert score == 0.0
    assert miss == "insufficient_history"


def test_xbi_rs_90d_outperformance():
    closes = _trend_closes(100, start=10.0, step=0.08)
    xbi = _trend_closes(100, start=50.0, step=0.01)
    score, miss = xbi_rs_90d_score(closes, xbi)
    assert miss is None
    assert score == 5.0


def test_xbi_rs_90d_insufficient_history():
    score, miss = xbi_rs_90d_score(_trend_closes(40), _trend_closes(40))
    assert score == 0.0
    assert miss == "insufficient_history"


def test_volume_ratio_thresholds():
    base = [1_000_000.0] * 20
    score, miss = volume_ratio_component_score(base + [5_500_000.0] * 5)
    assert miss is None
    assert score == 5.0

    score2, _ = volume_ratio_component_score(base + [2_500_000.0] * 5)
    assert score2 == 4.0

    score3, _ = volume_ratio_component_score(base + [1_500_000.0] * 5)
    assert score3 == 3.0

    score4, _ = volume_ratio_component_score(base + [1_150_000.0] * 5)
    assert score4 == 1.0

    score5, _ = volume_ratio_component_score(base + [900_000.0] * 5)
    assert score5 == 0.0


def test_compute_cluster_c_missing_flags():
    parts_raw, breakdown = compute_cluster_c(
        SdsTickerInput(
            ticker="SHORT",
            closes=_flat_closes(10),
            volumes=[1.0] * 10,
            xbi_closes=_flat_closes(10),
        )
    )
    assert parts_raw == 0.0
    assert breakdown["bollinger_squeeze"]["status"] == "insufficient_history"
    assert breakdown["obv_accumulation"]["status"] == "insufficient_history"
    assert breakdown["xbi_relative_strength"]["status"] == "insufficient_history"
    assert breakdown["volume_ratio"]["status"] == "insufficient_history"


def test_compute_cluster_c_full_pipeline():
    n = 150
    closes = _trend_closes(n)
    volumes = [800_000.0 + 5_000 * (i % 11) for i in range(n)]
    xbi = _trend_closes(n, start=40.0, step=0.01)
    raw, breakdown = compute_cluster_c(
        SdsTickerInput(ticker="FULL", closes=closes, volumes=volumes, xbi_closes=xbi)
    )
    total = (
        breakdown["bollinger_squeeze"]["score"]
        + breakdown["obv_accumulation"]["score"]
        + breakdown["xbi_relative_strength"]["score"]
        + breakdown["volume_ratio"]["score"]
    )
    assert total == raw
    assert raw >= 0
    assert breakdown["volume_ratio"].get("ratio_5d_vs_20d") is None or math.isfinite(
        breakdown["volume_ratio"]["ratio_5d_vs_20d"]
    )
    assert breakdown["bollinger_squeeze"]["status"] == "ok"


def test_bollinger_detail_interpretation():
    closes = _flat_closes(150, price=10.0, jitter=0.001)
    d = bollinger_squeeze_detail(closes)
    assert d["interpretation"] in ("extreme compression", "moderate compression", "normal")
