"""Tests for the general calibration circuit breaker."""
from __future__ import annotations

from prediction.calibration_circuit_breaker import evaluate_circuit_breaker


def _call(prev_values, mae_after, mae_baseline, proposed, **kw):
    return evaluate_circuit_breaker(
        key="regime:RISK_ON",
        proposed_value=proposed,
        prev_values=prev_values,
        mae_after=mae_after,
        mae_baseline=mae_baseline,
        **kw,
    )


def test_no_trigger_when_metrics_not_degrading():
    # Value drifts up consistently, but the mechanism keeps beating baseline.
    res = _call(
        prev_values=[1.0, 1.1, 1.2],
        mae_after=[7.0, 6.9, 6.8],
        mae_baseline=[7.2, 7.2, 7.2],
        proposed=1.3,
    )
    assert res.triggered is False
    assert res.value == 1.3


def test_no_trigger_when_value_not_diverging():
    # Metrics degrade, but the value oscillates rather than drifting one way.
    res = _call(
        prev_values=[1.0, 1.2, 0.95],
        mae_after=[7.5, 7.6, 7.7],
        mae_baseline=[7.2, 7.2, 7.2],
        proposed=1.1,
    )
    assert res.triggered is False


def test_trigger_freezes_to_last_good_value():
    # Monotonic drift away from 1.0 while after-MAE > baseline for the window.
    res = _call(
        prev_values=[1.0, 1.1, 1.2],
        mae_after=[7.1, 7.5, 7.9],
        mae_baseline=[7.2, 7.2, 7.2],
        proposed=1.3,
    )
    assert res.triggered is True
    assert res.reason == "diverging_while_degrading"
    # last non-degraded historical value was 1.0 (first week, after<baseline)
    assert res.frozen_to == 1.0
    assert res.value == 1.0


def test_trigger_on_downward_drift():
    res = _call(
        prev_values=[1.0, 0.9, 0.8],
        mae_after=[7.9, 8.0, 8.1],
        mae_baseline=[7.2, 7.2, 7.2],
        proposed=0.7,
    )
    assert res.triggered is True
    # no historical week was non-degraded -> falls back to neutral
    assert res.frozen_to == 1.0


def test_degrade_window_is_configurable():
    # With a 3-week degrade window, two degraded weeks are not enough.
    res = _call(
        prev_values=[1.0, 1.1, 1.2],
        mae_after=[7.0, 7.5, 7.9],
        mae_baseline=[7.2, 7.2, 7.2],
        proposed=1.3,
        degrade_window=3,
    )
    assert res.triggered is False
