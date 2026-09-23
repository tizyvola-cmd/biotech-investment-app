"""Tests for the historical regime backfill builder."""
from __future__ import annotations

import pytest

from prediction.backfill_regime_history import build_history_from_series


def _series(n: int, start: float, step: float) -> list[float]:
    return [start + step * i for i in range(n)]


def test_skips_days_without_enough_trailing_history():
    dates = [f"2026-01-{d:02d}" for d in range(1, 11)]  # only 10 days
    xbi = _series(10, 100.0, 1.0)
    tlt = _series(10, 50.0, 0.0)
    vix = [15.0] * 10
    out = build_history_from_series(dates, xbi, tlt, vix)
    assert out == {}  # 20-day window never satisfied


def test_classifies_risk_on_when_xbi_rallies():
    n = 30
    dates = [f"2026-03-{i+1:02d}" for i in range(n)]
    xbi = _series(n, 100.0, 1.0)  # steady up -> 5d and 20d returns positive
    tlt = _series(n, 50.0, 0.0)
    vix = [15.0] * n
    out = build_history_from_series(dates, xbi, tlt, vix)
    assert out[dates[-1]] == "RISK_ON"


def test_classifies_crisis_on_vix_spike():
    n = 30
    dates = [f"2026-03-{i+1:02d}" for i in range(n)]
    xbi = _series(n, 100.0, 1.0)
    tlt = _series(n, 50.0, 0.0)
    vix = [15.0] * (n - 1) + [40.0]  # spike on last day
    out = build_history_from_series(dates, xbi, tlt, vix)
    assert out[dates[-1]] == "CRISIS"


def test_classifies_risk_off_on_sector_drop():
    n = 30
    dates = [f"2026-03-{i+1:02d}" for i in range(n)]
    xbi = _series(n, 100.0, 0.0)
    xbi[-1] = xbi[-6] * 0.95  # -5% over 5d -> RISK_OFF
    tlt = _series(n, 50.0, 0.0)
    vix = [15.0] * n
    out = build_history_from_series(dates, xbi, tlt, vix)
    assert out[dates[-1]] == "RISK_OFF"


def test_rejects_misaligned_series():
    with pytest.raises(ValueError):
        build_history_from_series(["2026-01-01"], [1.0, 2.0], [1.0], [1.0])
