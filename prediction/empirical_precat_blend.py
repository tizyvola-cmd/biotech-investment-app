"""
Layer i: blend polynomial precat horizons with empirical cohort curve (μ distribuzione).

Attivazione: ``PRED_EMP_PRECATAL_BLEND=1`` (default on).
λ più alto quando ``emp_curve_pick == "shape"`` (match forma pre-CD vs cohort).
"""
from __future__ import annotations

import os
from typing import Any

# Chiave modello → offset calendario da CD (asse curva Accuracy / seq)
_HORIZON_OFFSETS: tuple[tuple[str, int], ...] = (
    ("model_dm60_pct", -60),
    ("model_dm30_pct", -30),
    ("model_dm10_pct", -10),
    ("model_dm7_pct", -7),
    ("model_dm5_pct", -5),
    ("model_dm3_pct", -3),
    ("model_d4_pct", 4),
    ("model_d7_pct", 7),
    ("d3_pct", 3),
    ("d5_pct", 5),
    ("d10_pct", 10),
    ("d30_pct", 30),
)

# Offset con mediana diretta in calibrazione (T−7…T+7): blend più forte
_DIRECT_MEDIAN_OFFSETS = frozenset({-7, -5, -3, -1, 1, 3, 5, 7})


def _env_enabled() -> bool:
    v = os.environ.get("PRED_EMP_PRECATAL_BLEND", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _blend_lambda(emp_shape_meta: dict | None) -> float:
    base = 0.28
    try:
        base = float(os.environ.get("PRED_EMP_PRECATAL_BLEND_LAM", "0.28"))
    except (TypeError, ValueError):
        pass
    meta = emp_shape_meta if isinstance(emp_shape_meta, dict) else {}
    if meta.get("emp_curve_pick") == "shape":
        return min(0.65, base + 0.18)
    if meta.get("precat_pts_ok"):
        return min(0.55, base + 0.08)
    return base


def _median_at(med: dict | None, off: int) -> float | None:
    if not isinstance(med, dict):
        return None
    for key in (off, str(off), f"+{off}" if off > 0 else str(off)):
        v = med.get(key)
        if v is None:
            continue
        try:
            x = float(v)
            return x if x == x else None
        except (TypeError, ValueError):
            continue
    return None


def _poly_eval(poly: list | None, t: float) -> float | None:
    if not poly:
        return None
    try:
        tt = float(t)
        deg = len(poly) - 1
        return float(
            sum(float(c) * (tt ** (deg - i)) for i, c in enumerate(poly))
        )
    except (TypeError, ValueError):
        return None


def _pwl_from_median(med: dict | None, t: float) -> float | None:
    if not med:
        return None
    xs: list[float] = []
    ys: list[float] = []
    for off in (-7, -5, -3, -1, 1, 3, 5, 7):
        v = _median_at(med, off)
        if v is None:
            continue
        xs.append(float(off))
        ys.append(float(v))
    if len(xs) < 2:
        return None
    pairs = sorted(zip(xs, ys))
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    tt = float(t)
    if tt <= xs[0]:
        x0, x1 = xs[0], xs[1]
        y0, y1 = ys[0], ys[1]
        if x1 == x0:
            return y0
        return y0 + (y1 - y0) * (tt - x0) / (x1 - x0)
    if tt >= xs[-1]:
        x0, x1 = xs[-2], xs[-1]
        y0, y1 = ys[-2], ys[-1]
        if x1 == x0:
            return y1
        return y1 + (y1 - y0) * (tt - x0) / (x1 - x0)
    for i in range(len(xs) - 1):
        if xs[i] <= tt <= xs[i + 1]:
            x0, x1 = xs[i], xs[i + 1]
            y0, y1 = ys[i], ys[i + 1]
            if x1 == x0:
                return y0
            return y0 + (y1 - y0) * (tt - x0) / (x1 - x0)
    return None


def empirical_pct_at_cd_offset(
    calibration_state: dict | None,
    ver: str,
    curve_cat: str,
    offset: int,
) -> float | None:
    """% cohort (baseline T−7) al offset calendario da CD via mediana / poly / PWL."""
    if not isinstance(calibration_state, dict):
        return None
    curves = calibration_state.get("curves") or {}
    if ver not in curves:
        return None
    cat = curve_cat if curve_cat in ("success", "failure", "neutral", "control") else "neutral"
    block = curves[ver].get(cat)
    if not isinstance(block, dict) or int(block.get("n") or 0) < 3:
        if cat != "neutral":
            block = curves[ver].get("neutral") or curves[ver].get("control")
        if not isinstance(block, dict) or int(block.get("n") or 0) < 3:
            return None
    med = block.get("median") or {}
    if offset in _DIRECT_MEDIAN_OFFSETS:
        v = _median_at(med, offset)
        if v is not None:
            return round(v, 2)
    v = _pwl_from_median(med, float(offset))
    if v is not None:
        return round(v, 2)
    poly = block.get("poly")
    pv = _poly_eval(poly, float(offset))
    return round(pv, 2) if pv is not None else None


def _blend_val(poly_v: float | None, emp_v: float | None, lam: float) -> float | None:
    if poly_v is None and emp_v is None:
        return None
    if poly_v is None:
        return round(float(emp_v), 1) if emp_v is not None else None
    if emp_v is None or lam <= 0:
        return round(float(poly_v), 1)
    return round((1.0 - lam) * float(poly_v) + lam * float(emp_v), 1)


def apply_empirical_precat_blend(
    horizons: dict[str, float | None],
    *,
    calibration_state: dict | None,
    ver: str = "v4_options",
    curve_cat: str,
    emp_shape_meta: dict | None = None,
) -> tuple[dict[str, float | None], dict[str, Any]]:
    """
    Ritorna (orizzonti aggiornati, meta). Non altera ``horizons`` in-place.
    """
    meta: dict[str, Any] = {"emp_precat_blend": "off"}
    if not _env_enabled():
        return dict(horizons), meta
    lam = _blend_lambda(emp_shape_meta)
    if lam <= 0:
        return dict(horizons), meta

    out = dict(horizons)
    n = 0
    for key, off in _HORIZON_OFFSETS:
        pv = horizons.get(key)
        if pv is None:
            continue
        off_lam = lam * (1.0 if off in _DIRECT_MEDIAN_OFFSETS else 0.55)
        ev = empirical_pct_at_cd_offset(calibration_state, ver, curve_cat, off)
        bv = _blend_val(pv, ev, off_lam)
        if bv is not None and bv != pv:
            out[key] = bv
            n += 1
    meta = {
        "emp_precat_blend": "on" if n else "skipped",
        "emp_precat_blend_lam": round(lam, 3),
        "emp_precat_blend_n": n,
        "emp_curve_cat": curve_cat,
    }
    return out, meta
