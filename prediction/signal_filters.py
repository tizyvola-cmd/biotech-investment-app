"""
Direction signal filters: rotation veto and UP confidence gate.

Used by evaluationFramework and (optionally) live direction_ensemble.
"""
from __future__ import annotations

from typing import Any

ROTATION_DIVERGENCE_PP_PER_DAY = 0.5
UP_MIN_VOL_RATIO = 1.2
UP_MAX_RSI = 65.0
UP_MIN_DAYS_TO_CD = 14


def is_slope_rotation(slope_5d: float | None, slope_20d: float | None) -> bool:
    """True when 5d and 20d slopes disagree beyond the divergence threshold."""
    if slope_5d is None or slope_20d is None:
        return False
    if abs(slope_5d) < 0.10 or abs(slope_20d) < 0.10:
        return False
    if (slope_5d > 0) == (slope_20d > 0):
        return False
    return abs(slope_5d - slope_20d) > ROTATION_DIVERGENCE_PP_PER_DAY


def apply_rotation_veto(direction: str, slope_5d: float | None, slope_20d: float | None) -> str:
    """
    Override UP/↑ signals to neutral when slope rotation is detected.
    Preserves DOWN and NEUTRAL labels.
    """
    d = str(direction or "").strip()
    if not d.startswith("↑"):
        return d
    if is_slope_rotation(slope_5d, slope_20d):
        return "→ Stabile"
    return d


def up_confidence_gate_passes(
    *,
    slope_5d: float | None,
    slope_20d: float | None,
    vol_ratio: float | None,
    rsi_14: float | None,
    days_to_cd: int | None,
    min_vol_ratio: float = UP_MIN_VOL_RATIO,
    max_rsi: float = UP_MAX_RSI,
    min_days_to_cd: int = UP_MIN_DAYS_TO_CD,
) -> tuple[bool, list[str]]:
    """
    UP is valid only when ALL conditions hold. Returns (passed, failed_reasons).
    """
    failed: list[str] = []
    if slope_5d is None or slope_20d is None or slope_5d <= 0 or slope_20d <= 0:
        failed.append("momentum_not_concordant_up")
    elif abs(slope_5d - slope_20d) >= ROTATION_DIVERGENCE_PP_PER_DAY:
        failed.append("slope_divergence")
    if vol_ratio is None or vol_ratio <= min_vol_ratio:
        failed.append("volume_not_confirmed")
    if rsi_14 is None or rsi_14 >= max_rsi:
        failed.append("rsi_overbought")
    if days_to_cd is not None and days_to_cd <= min_days_to_cd:
        failed.append("too_close_to_cd")
    return (len(failed) == 0, failed)


def apply_up_confidence_gate(direction: str, **kwargs: Any) -> str:
    """Emit NEUTRAL when UP gate fails."""
    d = str(direction or "").strip()
    if not d.startswith("↑"):
        return d
    ok, _ = up_confidence_gate_passes(**kwargs)
    return d if ok else "→ Stabile"


def direction_to_sign(direction: str) -> int:
    d = str(direction or "")
    if d.startswith("↑"):
        return 1
    if d.startswith("↓"):
        return -1
    return 0


__all__ = [
    "ROTATION_DIVERGENCE_PP_PER_DAY",
    "UP_MIN_VOL_RATIO",
    "UP_MAX_RSI",
    "UP_MIN_DAYS_TO_CD",
    "apply_rotation_veto",
    "apply_up_confidence_gate",
    "direction_to_sign",
    "is_slope_rotation",
    "up_confidence_gate_passes",
]
