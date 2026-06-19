"""
EIS (Event Impact Score) integration into precatalyst polynomial predictions.

- ``eis_augment_pairs_for_fit``: optional extra (dx, pct) knots from publications
  (skipped when a close already exists within ±2 calendar days in ``pairs``).
- ``apply_eis_poly_shift``: additive shift on model horizons proportional to
  aggregated pre-CD EIS — sustains / reinforces the polynomial extrapolation.
"""
from __future__ import annotations

from typing import Any

from prediction.config import get_config

PCT_KEYS = (
    "model_dm7_pct",
    "model_dm5_pct",
    "model_dm3_pct",
    "model_dm10_pct",
    "model_dm30_pct",
    "model_dm60_pct",
    "model_d4_pct",
    "model_d7_pct",
    "d3_pct",
    "d5_pct",
    "d10_pct",
    "d30_pct",
)


def _pair_dx_set(pairs: list[tuple[float, float]]) -> set[int]:
    return {round(p[0]) for p in pairs}


def eis_augment_pairs_for_fit(
    pairs: list[tuple[float, float]],
    events: list[dict[str, Any]],
    *,
    today,
    p_now: float,
    eis_agg: float | None = None,
) -> list[tuple[float, float]]:
    """
    Add publication-session points to the precat fit when not already covered
    by daily closes (±2 gg). Y may include a small EIS nudge on top of observed %.
    """
    if not get_config().pred_eis_poly_enabled or not events or p_now <= 0:
        return pairs

    from datetime import date as _date

    if hasattr(today, "date"):
        _today = today.date()
    else:
        _today = today

    existing = _pair_dx_set(pairs)
    extra: list[tuple[float, float]] = []

    for ev in events:
        ed_raw = ev.get("event_date")
        if ed_raw is None:
            continue
        try:
            ed = _date.fromisoformat(str(ed_raw)[:10])
        except ValueError:
            continue
        price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
        for key in ("p_t1", "p_t3"):
            px = price.get(key)
            if px is None:
                continue
            try:
                fp = float(px)
            except (TypeError, ValueError):
                continue
            if fp <= 0:
                continue
            dx = float((ed - _today).days)
            if key == "p_t3":
                dx += 3.0
            if not (-130.0 <= dx <= 0.0):
                continue
            if any(abs(dx - e) <= 2.0 for e in existing):
                continue
            pct = (fp / float(p_now) - 1.0) * 100.0
            extra.append((dx, round(pct, 3)))
            existing.add(round(dx))

    if not extra:
        return pairs
    return sorted(pairs + extra)


def eis_synthetic_anchor_pair(
    eis_agg: float | None,
    days_to_t: int,
) -> tuple[float, float] | None:
    """Single EIS-driven knot near the catalyst when no publication pair was added."""
    if not get_config().pred_eis_poly_enabled or eis_agg is None:
        return None
    if abs(float(eis_agg)) < 0.35:
        return None
    dx = float(max(-130, min(0, -min(10, max(2, int(days_to_t) // 2)))))
    pct = round(float(eis_agg) * get_config().pred_eis_poly_alpha * 0.6, 3)
    return (dx, pct)


def compute_eis_poly_shift_pp(
    eis_agg: float | None,
    *,
    extra_pp: float = 0.0,
) -> float:
    if not get_config().pred_eis_poly_enabled:
        return 0.0
    if eis_agg is None and not extra_pp:
        return 0.0
    raw = float(eis_agg or 0.0) * get_config().pred_eis_poly_alpha + float(extra_pp)
    cap = get_config().pred_eis_poly_max_shift
    if raw > cap:
        return cap
    if raw < -cap:
        return -cap
    return round(raw, 3)


def apply_eis_poly_shift(
    *,
    model_dm7_pct,
    model_dm5_pct,
    model_dm3_pct,
    model_dm10_pct,
    model_dm30_pct,
    model_dm60_pct,
    model_d4_pct,
    model_d7_pct,
    d3_pct,
    d5_pct,
    d10_pct,
    d30_pct,
    eis_agg: float | None,
    extra_shift_pp: float = 0.0,
) -> tuple[dict[str, float | None], dict[str, Any]]:
    """
    Apply uniform EIS shift to polynomial horizons (pre- and post-CD).
    ``extra_shift_pp``: additive shift from verified clinical KPIs (Catalyst Feed).
    Returns updated pct dict + metadata for ``pred`` row.
    """
    shift = compute_eis_poly_shift_pp(eis_agg, extra_pp=extra_shift_pp)
    if shift == 0.0:
        return (
            {
                "model_dm7_pct": model_dm7_pct,
                "model_dm5_pct": model_dm5_pct,
                "model_dm3_pct": model_dm3_pct,
                "model_dm10_pct": model_dm10_pct,
                "model_dm30_pct": model_dm30_pct,
                "model_dm60_pct": model_dm60_pct,
                "model_d4_pct": model_d4_pct,
                "model_d7_pct": model_d7_pct,
                "d3_pct": d3_pct,
                "d5_pct": d5_pct,
                "d10_pct": d10_pct,
                "d30_pct": d30_pct,
            },
            {},
        )

    def _add(v):
        if v is None:
            return None
        return round(float(v) + shift, 1)

    out = {k: _add(locals()[k]) for k in PCT_KEYS}
    meta = {
        "eis_poly_agg": eis_agg,
        "eis_poly_extra_pp": round(float(extra_shift_pp), 3) if extra_shift_pp else None,
        "eis_poly_shift_pp": shift,
        "eis_poly_applied": True,
    }
    return out, meta


__all__ = [
    "apply_eis_poly_shift",
    "compute_eis_poly_shift_pp",
    "eis_augment_pairs_for_fit",
    "eis_synthetic_anchor_pair",
    "PCT_KEYS",
]
