"""
General circuit breaker for calibration multipliers / cal_factors.

Freezes an updated calibration value when it keeps moving in the same direction
for several consecutive weekly updates *while* the mechanism's validation metric
degrades over the same window. Applies uniformly to any calibration layer
(regime multipliers, cluster cal_factors, ...), not a RISK_ON-specific patch.

The breaker is intentionally conservative: it never moves a value on its own, it
only *blocks* a further divergent update and surfaces a visible flag so the
condition is auditable (mirrors the explicit-flag discipline used elsewhere,
e.g. ``historyCloseSeriesLooksContaminated``).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

# --- Configuration (override via env) -------------------------------------
# Number of consecutive same-direction updates (incl. the proposed one) that
# count as a sustained drift away from the neutral value.
CB_CONSECUTIVE_MOVES = int(os.getenv("CB_CONSECUTIVE_MOVES", "3"))
# How many recent updates must show degraded validation metrics.
CB_DEGRADE_WINDOW = int(os.getenv("CB_DEGRADE_WINDOW", "2"))
# A mechanism update is "degraded" when its after-correction MAE exceeds the
# no-correction baseline MAE by more than this many percentage points.
CB_MAE_DEGRADE_PP = float(os.getenv("CB_MAE_DEGRADE_PP", "0.0"))
# Neutral value a calibration factor collapses to when it has no effect.
NEUTRAL_VALUE = 1.0


@dataclass
class CircuitBreakerResult:
    triggered: bool
    value: float
    frozen_to: float | None = None
    reason: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)


def _moves_same_direction_away_from_neutral(values: list[float], moves: int) -> bool:
    """True when the last ``moves`` deltas share one sign and push away from 1.0."""
    if moves < 1 or len(values) < moves + 1:
        return False
    tail = values[-(moves + 1):]
    deltas = [b - a for a, b in zip(tail, tail[1:])]
    if any(abs(d) < 1e-9 for d in deltas):
        return False
    if not (all(d > 0 for d in deltas) or all(d < 0 for d in deltas)):
        return False
    distances = [abs(v - NEUTRAL_VALUE) for v in tail]
    return all(b > a for a, b in zip(distances, distances[1:]))


def _degraded_flags(
    mae_after: list[float | None],
    mae_baseline: list[float | None],
    tol_pp: float,
) -> list[bool]:
    flags: list[bool] = []
    for after, base in zip(mae_after, mae_baseline):
        if after is None or base is None:
            flags.append(False)
        else:
            flags.append(float(after) > float(base) + tol_pp)
    return flags


def evaluate_circuit_breaker(
    *,
    key: str,
    proposed_value: float,
    prev_values: list[float],
    mae_after: list[float | None],
    mae_baseline: list[float | None],
    consecutive_moves: int = CB_CONSECUTIVE_MOVES,
    degrade_window: int = CB_DEGRADE_WINDOW,
    mae_degrade_pp: float = CB_MAE_DEGRADE_PP,
) -> CircuitBreakerResult:
    """Decide whether ``proposed_value`` may be applied for calibration ``key``.

    ``prev_values`` and the metric lists are chronological (oldest first); the
    metric lists describe the *already applied* historical updates that produced
    ``prev_values``. Trigger requires both:
      * the value drifts the same direction away from 1.0 for ``consecutive_moves``
        consecutive updates (history + proposed), and
      * the mechanism degraded (after-MAE > baseline-MAE + tol) on each of the
        last ``degrade_window`` updates.
    On trigger the value is frozen to the most recent non-degraded historical
    value (else the neutral value).
    """
    values = [float(v) for v in prev_values] + [float(proposed_value)]
    drift = _moves_same_direction_away_from_neutral(values, consecutive_moves)

    degraded = _degraded_flags(mae_after, mae_baseline, mae_degrade_pp)
    recent = degraded[-degrade_window:] if degrade_window > 0 else []
    metrics_degrading = len(recent) >= degrade_window and degrade_window > 0 and all(recent)

    if not (drift and metrics_degrading):
        return CircuitBreakerResult(
            triggered=False,
            value=float(proposed_value),
            detail={
                "key": key,
                "drift": drift,
                "metrics_degrading": metrics_degrading,
            },
        )

    frozen_to = NEUTRAL_VALUE
    for value, is_degraded in zip(reversed(prev_values), reversed(degraded)):
        if not is_degraded:
            frozen_to = float(value)
            break

    return CircuitBreakerResult(
        triggered=True,
        value=frozen_to,
        frozen_to=frozen_to,
        reason="diverging_while_degrading",
        detail={
            "key": key,
            "proposed_value": float(proposed_value),
            "consecutive_moves": consecutive_moves,
            "degrade_window": degrade_window,
            "mae_degrade_pp": mae_degrade_pp,
            "recent_degraded": recent,
        },
    )
