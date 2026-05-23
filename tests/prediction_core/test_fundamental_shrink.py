"""Tests for fundamental curve shrink (beta + FY liquidity)."""
from __future__ import annotations

import math

import pytest

from prediction.fundamental_shrink import (
    apply_fundamental_curve_shrink,
    beta_shrink_factor,
    liquidity_shrink_factor,
)


@pytest.mark.parametrize(
    "score,expected",
    [
        (None, 1.0),
        (1.0, 1.0),
        (0.0, 0.5),
        (0.5, 0.75),
        (0.2, max(0.35, 0.5 + 0.1)),
    ],
)
def test_liquidity_shrink_factor(score: float | None, expected: float) -> None:
    assert liquidity_shrink_factor(score) == pytest.approx(expected)


@pytest.mark.parametrize(
    "beta,expected",
    [
        (None, 1.0),
        (1.0, 1.0),
        (2.0, 0.5),
        (0.4, 1.2),
        (3.0, 1.0 / 3.0),
    ],
)
def test_beta_shrink_factor(beta: float | None, expected: float) -> None:
    assert beta_shrink_factor(beta) == pytest.approx(expected)


def test_missing_inputs_identity() -> None:
    raw = {"d5_pct": 10.0, "model_dm30_pct": -8.0}
    out = apply_fundamental_curve_shrink(raw, liquidity_score=None, beta=None)
    assert out == raw


def test_combined_dict_shrink() -> None:
    raw = {"d5_pct": 20.0, "other": 99.0}
    out = apply_fundamental_curve_shrink(
        raw,
        liquidity_score=0.0,
        beta=2.0,
    )
    f = liquidity_shrink_factor(0.0) * beta_shrink_factor(2.0)
    assert out["d5_pct"] == pytest.approx(round(20.0 * f, 1))
    assert out["other"] == 99.0


def test_scalar_and_sequence() -> None:
    assert apply_fundamental_curve_shrink(10.0, liquidity_score=1.0, beta=1.0) == 10.0
    seq = apply_fundamental_curve_shrink(
        [10.0, None, -4.0],
        liquidity_score=1.0,
        beta=1.0,
    )
    assert seq == [10.0, None, -4.0]


def test_apply_flags_off() -> None:
    out = apply_fundamental_curve_shrink(
        {"d3_pct": 12.0},
        liquidity_score=0.0,
        beta=2.0,
        apply_liquidity=False,
        apply_beta=False,
    )
    assert out["d3_pct"] == 12.0


def test_factors_finite() -> None:
    assert math.isfinite(liquidity_shrink_factor(float("nan")))
    assert beta_shrink_factor(float("inf")) == 1.0
