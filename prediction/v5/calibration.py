"""
Calibrazione retroattiva fan v5 da ``past_catalyst_predictions``.

Scala la semi-larghezza q05/q95 intorno a q50 (MAE empirica vs banda MC).
"""
from __future__ import annotations

import json
import math
import statistics
from pathlib import Path
from typing import Any, Mapping

from prediction.v5.cohort_prior import realized_pct_vs_m60_at_offset

# Stessi offset del foglio Accuracy (evita import circolare con pipeline).
_V5_CALIB_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)
from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution

V5_CALIB_PATH = Path("data") / "pred_v5_calibration.json"
_MIN_HALF_WIDTH_PP = 0.35
_SIGMA_CLAMP = (0.55, 2.75)


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def load_v5_calibration() -> dict[str, Any] | None:
    if not V5_CALIB_PATH.is_file():
        return None
    try:
        raw = json.loads(V5_CALIB_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def save_v5_calibration(state: dict[str, Any]) -> None:
    V5_CALIB_PATH.parent.mkdir(parents=True, exist_ok=True)
    V5_CALIB_PATH.write_text(
        json.dumps(state, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def apply_v5_calibration_to_distribution(
    dist: PredictionDistribution,
    state: Mapping[str, Any] | None,
) -> bool:
    """Scala q05/q95 intorno a q50; q50 invariato. Returns True se applicato."""
    if not state or not isinstance(state, dict):
        return False
    global_scale = _float_or_none(state.get("sigma_scale"))
    if global_scale is None or global_scale <= 0:
        return False
    per_off = state.get("sigma_scale_by_offset")
    if not isinstance(per_off, dict):
        per_off = {}
    nodes = dict(dist.nodes)
    applied = False
    for off, node in list(nodes.items()):
        sk = str(off)
        scale = _float_or_none(per_off.get(sk))
        if scale is None or scale <= 0:
            scale = global_scale
        scale = max(_SIGMA_CLAMP[0], min(_SIGMA_CLAMP[1], float(scale)))
        q50 = float(node.q50)
        lo_hw = max(float(q50) - float(node.q05), _MIN_HALF_WIDTH_PP)
        hi_hw = max(float(node.q95) - float(q50), _MIN_HALF_WIDTH_PP)
        nodes[off] = CurveNodeQuantiles(
            offset=int(off),
            q05=round(q50 - lo_hw * scale, 4),
            q50=round(q50, 4),
            q95=round(q50 + hi_hw * scale, 4),
        )
        applied = True
    dist.nodes = nodes
    if applied:
        meta = dict(dist.metadata or {})
        meta["v5_calib_sigma_scale"] = round(global_scale, 4)
        dist.metadata = meta
    return applied


def fit_v5_calibration_from_past_rows(
    past_rows: Mapping[str, Mapping[str, Any]] | None,
    *,
    max_fit_rows: int = 120,
) -> dict[str, Any]:
    """
    Stima ``sigma_scale`` globale: mediana |q50−realized| / semi-larghezza MC.

    Usa la stessa pipeline di produzione (cohort, anchor v4, calib) via
    ``predict_v5_fan_offsets`` su righe storiche con traiettoria realizzata.
    """
    from prediction.pipeline import predict_v5_fan_offsets

    ratios: list[float] = []
    n_used = 0
    rows = past_rows or {}
    for _pk, row in list(rows.items())[: max_fit_rows * 3]:
        if not isinstance(row, dict) or n_used >= max_fit_rows:
            break
        _v5_in = {
            "slope_20d": row.get("slope_20d"),
            "run_up_30d": row.get("run_up_30d"),
            "exc_slope": row.get("exc_slope") or row.get("exc_slope_vs_XBI"),
            "exc_slope_vs_XBI": row.get("exc_slope_vs_XBI") or row.get("exc_slope"),
            "expected_move_pct": row.get("expected_move_pct"),
            "model_d5_pct": row.get("model_dm5_pct") or row.get("model_d5_pct"),
            "beta": row.get("beta"),
            "liquidity_score": row.get("liquidity_score"),
            "vol_20d": row.get("vol_20d"),
            "direction": row.get("direction"),
            "dir_v4": row.get("dir_v4"),
            "model_dm60_pct": row.get("model_dm60_pct"),
            "model_dm30_pct": row.get("model_dm30_pct"),
            "model_dm10_pct": row.get("model_dm10_pct"),
            "model_dm7_pct": row.get("model_dm7_pct"),
            "model_dm5_pct": row.get("model_dm5_pct"),
            "model_dm3_pct": row.get("model_dm3_pct"),
            "model_d4_pct": row.get("model_d4_pct"),
            "model_d7_pct": row.get("model_d7_pct"),
        }
        try:
            fan = predict_v5_fan_offsets(
                _v5_in, past_pred_rows=past_rows, apply_calibration=False
            )
        except Exception:
            continue
        row_had = False
        for off in _V5_CALIB_OFFSETS:
            if off == -60:
                continue
            act = realized_pct_vs_m60_at_offset(row, off)
            if act is None:
                continue
            node = fan.get(str(off)) if isinstance(fan, dict) else None
            if not isinstance(node, dict):
                continue
            q50 = _float_or_none(node.get("q50"))
            q05 = _float_or_none(node.get("q05"))
            q95 = _float_or_none(node.get("q95"))
            if q50 is None:
                continue
            err = abs(q50 - act)
            if err < 0.05:
                continue
            hw = max((q95 - q05) / 2.0 if q05 is not None and q95 is not None else 0.0, _MIN_HALF_WIDTH_PP)
            ratios.append(err / hw)
            row_had = True
        if row_had:
            n_used += 1

    if len(ratios) < 8:
        sigma = 1.0
    else:
        sigma = statistics.median(ratios)
        sigma = max(_SIGMA_CLAMP[0], min(_SIGMA_CLAMP[1], float(sigma)))

    return {
        "version": 1,
        "sigma_scale": round(sigma, 4),
        "n_fit_rows": n_used,
        "n_ratio_samples": len(ratios),
        "sigma_scale_by_offset": {},
    }


def ensure_v5_calibration_fitted(
    past_rows: Mapping[str, Mapping[str, Any]] | None,
    *,
    force: bool = False,
) -> dict[str, Any] | None:
    """Carica da disco o ricalcola e salva se mancante / ``force``."""
    if not force:
        loaded = load_v5_calibration()
        if loaded and loaded.get("sigma_scale") is not None:
            return loaded
    state = fit_v5_calibration_from_past_rows(past_rows)
    if state.get("n_ratio_samples", 0) >= 4:
        save_v5_calibration(state)
        return state
    return load_v5_calibration()
