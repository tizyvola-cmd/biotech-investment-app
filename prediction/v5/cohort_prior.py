"""
Prior di coorte da ``past_catalyst_predictions`` (filtro NCT ristretto).

Usa traiettorie **realizzate** % vs T−60 quando disponibili (``curve_act_pct``,
chiusure ``close_m60`` / ``close_m*_cal``), altrimenti nodi ``model_dm*`` come fallback.
"""
from __future__ import annotations

import math
import statistics
from typing import Any, Mapping

from prediction.nct_cohort import filter_past_pred_by_restricted_nct
from prediction.v5.schema import NODE_OFFSETS

# Offset calendario → chiavi close (preferenza _cal poi sessione)
_CLOSE_KEYS_BY_OFFSET: dict[int, tuple[str, ...]] = {
    -60: ("close_m60_cal", "close_m60"),
    -30: ("close_m30_cal", "close_m30"),
    -10: ("close_m10_cal", "close_m10"),
    -7: ("close_m7",),
    -5: ("close_m5",),
    -3: ("close_m3",),
    0: ("price_at_cd",),
    4: ("close_p4",),
    7: ("close_p7",),
}

_MODEL_KEY_BY_OFFSET: dict[int, str] = {
    -60: "model_dm60_pct",
    -30: "model_dm30_pct",
    -10: "model_dm10_pct",
    -7: "model_dm7_pct",
    -5: "model_dm5_pct",
    -3: "model_dm3_pct",
    0: "model_d5_pct",
    4: "model_d4_pct",
    7: "model_d7_pct",
}


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _curve_act_lookup(row: Mapping[str, Any], offset: int) -> float | None:
    raw = row.get("curve_act_pct")
    if not isinstance(raw, dict):
        return None
    for key in (str(offset), f"{offset:+d}" if offset != 0 else "0"):
        v = _float_or_none(raw.get(key))
        if v is not None:
            return v
    return None


def _close_lookup(row: Mapping[str, Any], keys: tuple[str, ...]) -> float | None:
    for k in keys:
        v = _float_or_none(row.get(k))
        if v is not None and v > 0:
            return v
    return None


def realized_pct_vs_m60_at_offset(row: Mapping[str, Any], offset: int) -> float | None:
    """% realizzato vs prezzo T−60 (0 al nodo −60)."""
    if offset == -60:
        return 0.0
    act = _curve_act_lookup(row, offset)
    if act is not None:
        return round(act, 2)
    base = _close_lookup(row, _CLOSE_KEYS_BY_OFFSET[-60])
    if base is None or base <= 0:
        return _float_or_none(row.get(_MODEL_KEY_BY_OFFSET.get(offset, "")))
    px_keys = _CLOSE_KEYS_BY_OFFSET.get(offset)
    if not px_keys:
        return _float_or_none(row.get(_MODEL_KEY_BY_OFFSET.get(offset, "")))
    px = _close_lookup(row, px_keys)
    if px is None:
        return _float_or_none(row.get(_MODEL_KEY_BY_OFFSET.get(offset, "")))
    return round((px / base - 1.0) * 100.0, 2)


def build_nct_cohort_mu(
    past_pred_rows: Mapping[str, Mapping[str, Any]] | None,
    *,
    offsets: tuple[int, ...] = NODE_OFFSETS,
    min_members: int = 8,
    use_nct_filter: bool = True,
) -> dict[int, float] | None:
    """
    Mediana % vs T−60 per offset su coorte NCT (direct/collaborator/correlated).

    Returns ``None`` se meno di ``min_members`` righe utili.
    """
    rows = dict(past_pred_rows or {})
    if use_nct_filter:
        rows = filter_past_pred_by_restricted_nct(rows)
    if not rows:
        return None

    by_off: dict[int, list[float]] = {o: [] for o in offsets}
    for row in rows.values():
        if not isinstance(row, dict):
            continue
        for off in offsets:
            v = realized_pct_vs_m60_at_offset(row, off)
            if v is not None:
                by_off[off].append(float(v))

    if len(rows) < min_members:
        return None

    out: dict[int, float] = {}
    populated = 0
    for off in offsets:
        vals = by_off.get(off) or []
        if len(vals) < max(3, min_members // 3):
            continue
        out[off] = round(statistics.median(vals), 2)
        populated += 1
    if populated < 3:
        return None
    out.setdefault(-60, 0.0)
    return out


def load_past_pred_rows_from_disk() -> dict[str, dict]:
    """Carica ``rows`` da ``data/past_catalyst_predictions.json``."""
    import json
    import pathlib

    p = pathlib.Path("data") / "past_catalyst_predictions.json"
    if not p.exists():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        rows = doc.get("rows") if isinstance(doc, dict) else None
        return dict(rows) if isinstance(rows, dict) else {}
    except Exception:
        return {}
