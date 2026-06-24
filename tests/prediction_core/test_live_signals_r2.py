"""STEP 1 — R² regime in refresh_live_signals._affidabilita and _r2_linear."""

from __future__ import annotations

import math

import pytest

from refresh_live_signals import _affidabilita, _r2_linear


def _r2_adj_only(
    r2: float | None,
    *,
    days_to_cd: int = 10,
    slope_20d: float = 1.0,
) -> int:
    """Affidabilità con solo R² variabile (altri input neutri)."""
    base = _affidabilita(days_to_cd, None, slope_20d, None, None, None, None)
    full = _affidabilita(days_to_cd, None, slope_20d, None, None, None, r2)
    return full - base


def test_flat_pre_cd_r2_no_penalty():
    """r2 < 0.10: prezzo piatto pre-CD — nessuna penalità R²."""
    assert _r2_adj_only(0.05) == 0
    assert _r2_adj_only(0.08) == 0


def test_weak_fit_penalties():
    assert _r2_adj_only(0.30) == -5
    assert _r2_adj_only(0.15) == -10


def test_acceptable_fit_neutral():
    assert _r2_adj_only(0.50) == 0


def test_strong_fit_positive_slope_bonus():
    assert _r2_adj_only(0.60, slope_20d=2.0) == 5
    assert _r2_adj_only(0.60, slope_20d=-1.0) == 0


def test_r2_linear_flat_series_low_r2():
    flat = [10.0] * 50
    r2 = _r2_linear(flat, 45)
    assert r2 is not None
    assert r2 < 0.10


def test_r2_linear_trend_positive_r2():
    trend = [10.0 + i * 0.2 for i in range(50)]
    r2 = _r2_linear(trend, 45)
    assert r2 is not None
    assert r2 > 0.5


def test_r2_linear_insufficient_data():
    assert _r2_linear([1.0, 2.0], 45) is None
