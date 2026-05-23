"""Tests for v5 MRM + PCG prototype."""
from __future__ import annotations

import math

import pytest

from prediction.v5.mrm import classify_regime, drift_sigma_from_prices
from prediction.v5.predict import predict_v5_curve
from prediction.v5.schema import NODE_OFFSETS


def _trend_prices(n: int = 80, *, drift: float = 0.004) -> list[float]:
    p = 100.0
    out = [p]
    for _ in range(n - 1):
        p *= 1.0 + drift
        out.append(p)
    return out


def _mean_revert_prices(n: int = 80) -> list[float]:
    out = [100.0 + 8.0 * math.sin(i / 4.0) for i in range(n)]
    return [max(1.0, x) for x in out]


def _high_vol_prices(n: int = 80) -> list[float]:
    import random

    rng = random.Random(0)
    p = 50.0
    out = [p]
    for _ in range(n - 1):
        p *= 1.0 + rng.uniform(-0.06, 0.06)
        out.append(max(1.0, p))
    return out


@pytest.mark.parametrize(
    "label,kwargs,prices,expected_regime",
    [
        (
            "trend_up",
            {"slope_20d": 0.35, "vol_20d": 0.02, "run_up_30d": 12.0},
            _trend_prices(),
            "trend",
        ),
        (
            "mean_revert",
            {"slope_20d": -0.05, "vol_20d": 0.025, "run_up_30d": 28.0},
            _mean_revert_prices(),
            "mean_revert",
        ),
        (
            "high_vol",
            {"slope_20d": 0.1, "vol_20d": 0.06, "run_up_30d": 5.0},
            _high_vol_prices(),
            "high_vol",
        ),
    ],
)
def test_v5_regime_and_quantiles(
    label: str,
    kwargs: dict,
    prices: list[float],
    expected_regime: str,
) -> None:
    seed = {"trend_up": 11, "mean_revert": 22, "high_vol": 33}[label]
    regime = classify_regime(**kwargs)
    assert regime.label == expected_regime

    dist = predict_v5_curve(
        prices=prices,
        cd_anchor_pct=4.0,
        n_paths=1500,
        seed=seed,
        **kwargs,
    )
    assert dist.regime == expected_regime
    assert set(dist.nodes.keys()) == set(NODE_OFFSETS)

    q50_cd = dist.nodes[0].q50
    for off, node in dist.nodes.items():
        assert node.q05 <= node.q50 <= node.q95
        if off < 0:
            assert node.q50 <= q50_cd + 25.0
        if off > 0:
            assert node.q50 >= q50_cd - 10.0


def test_drift_sigma_from_prices_trend() -> None:
    r = drift_sigma_from_prices(_trend_prices())
    assert r.label in ("trend", "high_vol", "mean_revert")
    assert r.sigma_per_day > 0


def test_predict_v5_monotonic_toward_anchor() -> None:
    dist = predict_v5_curve(
        slope_20d=0.25,
        vol_20d=0.02,
        run_up_30d=10.0,
        cd_anchor_pct=6.0,
        n_paths=2000,
        seed=99,
    )
    pre = [dist.nodes[o].q50 for o in (-60, -30, -10, -7)]
    assert pre[-1] <= dist.nodes[0].q50 + 2.0
    assert dist.nodes[7].q50 >= dist.nodes[0].q50 - 5.0
