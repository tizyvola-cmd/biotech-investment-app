"""
Display-curve helpers: cal_factor scaling, pre/post cap split (used by sheets + model interp).
"""
from __future__ import annotations

import os
from typing import Any, Mapping, Sequence

from prediction.config import pred_curve_apply_cal_factor_enabled


def cal_factor_v4_from_row(row: Mapping[str, Any] | None) -> float:
    """``cal_factor`` v4 on prediction row (default 1.0)."""
    if not isinstance(row, Mapping):
        return 1.0
    cf = row.get("cal_factor")
    if cf is None:
        return 1.0
    try:
        x = float(cf)
        return x if x == x and x > 0 else 1.0
    except (TypeError, ValueError):
        return 1.0


def scale_display_pct_points_cal_factor(
    pts: Sequence[float | None],
    offsets: Sequence[int],
    cal_factor: float,
    *,
    anchor_offset: int = -60,
    row: Mapping[str, Any] | None = None,
) -> list[float | None]:
    """
    Scala % vs T−60: cluster CF + regime (optional row) then global ``cal_factor`` v4.
    """
    if not pred_curve_apply_cal_factor_enabled():
        return list(pts)
    try:
        cf = float(cal_factor)
    except (TypeError, ValueError):
        return list(pts)

    from prediction.learning_apply import apply_magnitude_learning

    n = len(offsets)
    out: list[float | None] = []
    for i in range(n):
        off = int(offsets[i]) if i < len(offsets) else 0
        p = pts[i] if i < len(pts) else None
        if off == int(anchor_offset):
            if p is None or (isinstance(p, float) and p != p):
                out.append(0.0)
            else:
                out.append(round(float(p), 2))
            continue
        if p is None or (isinstance(p, float) and p != p):
            out.append(None)
            continue
        try:
            base = float(p)
            learned = apply_magnitude_learning(base, row) if row is not None else base
            scaled = learned if abs(cf - 1.0) < 1e-6 else learned * cf
            out.append(round(scaled, 2))
        except (TypeError, ValueError):
            out.append(None)
    return out


def pred_cap_abs_pp_precd() -> float:
    """Cap |%| su orizzonti pre-CD (``model_dm*``); default più largo del post-CD."""
    try:
        return float(os.environ.get("PRED_CAP_ABS_PP_PRECD", "35").strip() or "35")
    except ValueError:
        return 35.0
