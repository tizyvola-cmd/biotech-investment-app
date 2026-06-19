"""
v4 curve magnitude shrink from FY liquidity and market beta (5Y).

Unified replacement for ``apply_liquidity_risk_shrink`` — do not call that hook
separately when fundamental shrink is enabled.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from prediction.config import (
    pred_fundamental_shrink_enabled,
    pred_fundamental_shrink_precd_enabled,
    pred_v4_curve_scale,
    pred_v4_curve_scale_precd,
)

# Pre-CD (polynomial extrap) vs post-CD (event horizons).
FUNDAMENTAL_SHRINK_PRECD_KEYS: tuple[str, ...] = (
    "model_dm7_pct",
    "model_dm5_pct",
    "model_dm3_pct",
    "model_dm10_pct",
    "model_dm30_pct",
    "model_dm60_pct",
)
FUNDAMENTAL_SHRINK_POSTCD_KEYS: tuple[str, ...] = (
    "model_d1_pct",
    "model_d3_pct",
    "model_d5_pct",
    "model_d7_pct",
    "model_d10_pct",
    "model_d30_pct",
    "model_d4_pct",
    "d3_pct",
    "d5_pct",
    "d10_pct",
    "d30_pct",
)
FUNDAMENTAL_SHRINK_PCT_KEYS: tuple[str, ...] = (
    FUNDAMENTAL_SHRINK_PRECD_KEYS + FUNDAMENTAL_SHRINK_POSTCD_KEYS
)


def _coerce_liquidity_score(liquidity_score: float | None) -> float:
    if liquidity_score is None:
        return 1.0
    try:
        x = float(liquidity_score)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(x):
        return 1.0
    return max(0.0, min(1.0, x))


def _coerce_beta(beta: float | None) -> float:
    if beta is None:
        return 1.0
    try:
        x = float(beta)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(x) or x <= 0:
        return 1.0
    return x


def liquidity_shrink_factor(liquidity_score: float | None) -> float:
    """``f_liq = max(0.35, 0.5 + 0.5 * liquidity_score)`` (missing → 1.0)."""
    liq = _coerce_liquidity_score(liquidity_score)
    return max(0.35, 0.5 + 0.5 * liq)


def beta_shrink_factor(beta: float | None) -> float:
    """``f_beta = min(1.2, 1 / max(beta, 0.4))`` (missing → 1.0)."""
    b = _coerce_beta(beta)
    return min(1.2, 1.0 / max(b, 0.4))


def compute_fundamental_shrink_factors(
    liquidity_score: float | None,
    beta: float | None,
) -> dict[str, float]:
    f_liq = liquidity_shrink_factor(liquidity_score)
    f_beta = beta_shrink_factor(beta)
    m = f_liq * f_beta
    return {
        "f_liq": round(f_liq, 4),
        "f_beta": round(f_beta, 4),
        "fundamental_shrink_m": round(m, 4),
    }


def apply_fundamental_curve_shrink(
    pct: float | Mapping[str, Any] | Sequence[float | None] | None,
    *,
    liquidity_score: float | None = None,
    beta: float | None = None,
    apply_liquidity: bool = True,
    apply_beta: bool = True,
) -> Any:
    """
    Scale pct value(s) by fundamental ``m`` when shrink is enabled.

    Scalar → scaled float; dict → only ``FUNDAMENTAL_SHRINK_PCT_KEYS``; sequence → list.
    """
    if not pred_fundamental_shrink_enabled():
        return pct
    f_liq = liquidity_shrink_factor(liquidity_score) if apply_liquidity else 1.0
    f_beta = beta_shrink_factor(beta) if apply_beta else 1.0
    m = f_liq * f_beta

    if pct is None:
        return None
    if isinstance(pct, Mapping):
        out = dict(pct)
        for k in FUNDAMENTAL_SHRINK_PCT_KEYS:
            if k in out and out[k] is not None:
                out[k] = round(float(out[k]) * m, 1)
        return out
    if isinstance(pct, (list, tuple)):
        return [
            round(float(v) * m, 1) if v is not None else None for v in pct
        ]
    try:
        return round(float(pct) * m, 1)
    except (TypeError, ValueError):
        return pct


def apply_fundamental_shrink_horizons(
    horizons: dict[str, float | None],
    *,
    liquidity_score: float | None,
    beta: float | None,
    keys: tuple[str, ...] | None = None,
) -> dict[str, float]:
    """
    Multiply all listed horizon keys in ``horizons`` by ``m`` (in place).

    Returns shrink meta ``{f_liq, f_beta, fundamental_shrink_m}``.
    """
    meta = compute_fundamental_shrink_factors(liquidity_score, beta)
    if not pred_fundamental_shrink_enabled():
        return meta
    m = meta["fundamental_shrink_m"]
    for k in keys or FUNDAMENTAL_SHRINK_PCT_KEYS:
        v = horizons.get(k)
        if v is not None:
            horizons[k] = round(float(v) * m, 1)
    return meta


def apply_v4_curve_scale_horizons(
    horizons: dict[str, float | None],
    *,
    scale: float | None = None,
    keys: tuple[str, ...] | None = None,
) -> float:
    """Multiply horizon pcts by ``PRED_V4_CURVE_SCALE`` (default 1.0, no-op)."""
    s = pred_v4_curve_scale() if scale is None else float(scale)
    if not math.isfinite(s) or abs(s - 1.0) < 1e-9:
        return s
    for k in keys or FUNDAMENTAL_SHRINK_PCT_KEYS:
        v = horizons.get(k)
        if v is not None:
            horizons[k] = round(float(v) * s, 1)
    return s


def apply_fundamental_shrink_pred_row(row: dict[str, Any]) -> dict[str, float]:
    """Apply shrink to pct keys present on a prediction / past-pred dict."""
    liq = row.get("liquidity_score")
    b = row.get("beta")
    subset = {k: row.get(k) for k in FUNDAMENTAL_SHRINK_PCT_KEYS if k in row}
    meta = apply_fundamental_shrink_horizons(
        subset, liquidity_score=liq, beta=b, keys=tuple(subset.keys())
    )
    for k, v in subset.items():
        row[k] = v
    row.update(meta)
    return meta


def apply_v4_final_horizon_adjustments(
    horizons: dict[str, float | None],
    *,
    liquidity_score: float | None,
    beta: float | None,
    keys: tuple[str, ...] | None = None,
) -> dict[str, float]:
    """
    Post post-hoc: shrink post-CD (default); pre-CD solo se ``PRED_FUNDAMENTAL_SHRINK_PRECD=1``.

    Scala: ``PRED_V4_CURVE_SCALE_PRECD`` (default 1.05) su ``model_dm*``;
    ``PRED_V4_CURVE_SCALE`` (default 1.0) su orizzonti post-CD.
    Se ``PRED_V4_CURVE_SCALE`` ≠ 1 e ``PRED_V4_CURVE_SCALE_PRECD`` non è impostato,
    scala tutti i campi (compatibilità legacy).
    """
    import os

    use_keys = keys or tuple(k for k in FUNDAMENTAL_SHRINK_PCT_KEYS if k in horizons)
    pre_keys = tuple(k for k in FUNDAMENTAL_SHRINK_PRECD_KEYS if k in use_keys)
    post_keys = tuple(k for k in FUNDAMENTAL_SHRINK_POSTCD_KEYS if k in use_keys)

    meta: dict[str, float] = {}
    if pred_fundamental_shrink_enabled() and post_keys:
        meta = apply_fundamental_shrink_horizons(
            horizons, liquidity_score=liquidity_score, beta=beta, keys=post_keys
        )
    if pred_fundamental_shrink_enabled() and pred_fundamental_shrink_precd_enabled() and pre_keys:
        _pre_meta = apply_fundamental_shrink_horizons(
            horizons, liquidity_score=liquidity_score, beta=beta, keys=pre_keys
        )
        meta = {**meta, **_pre_meta}

    _global_scale = pred_v4_curve_scale()
    _precd_env = os.environ.get("PRED_V4_CURVE_SCALE_PRECD", "").strip()
    if not _precd_env and abs(_global_scale - 1.0) >= 1e-9:
        _s = apply_v4_curve_scale_horizons(horizons, scale=_global_scale, keys=use_keys)
        if abs(_s - 1.0) >= 1e-9:
            meta["v4_curve_scale"] = round(_s, 4)
        return meta

    if pre_keys:
        _sp = apply_v4_curve_scale_horizons(
            horizons, scale=pred_v4_curve_scale_precd(), keys=pre_keys
        )
        if abs(_sp - 1.0) >= 1e-9:
            meta["v4_curve_scale_precd"] = round(_sp, 4)
    if post_keys:
        _sg = apply_v4_curve_scale_horizons(
            horizons, scale=_global_scale, keys=post_keys
        )
        if abs(_sg - 1.0) >= 1e-9:
            meta["v4_curve_scale"] = round(_sg, 4)
    return meta


__all__ = [
    "FUNDAMENTAL_SHRINK_PRECD_KEYS",
    "FUNDAMENTAL_SHRINK_POSTCD_KEYS",
    "FUNDAMENTAL_SHRINK_PCT_KEYS",
    "apply_fundamental_curve_shrink",
    "apply_fundamental_shrink_horizons",
    "apply_fundamental_shrink_pred_row",
    "apply_v4_curve_scale_horizons",
    "apply_v4_final_horizon_adjustments",
    "beta_shrink_factor",
    "compute_fundamental_shrink_factors",
    "liquidity_shrink_factor",
]
