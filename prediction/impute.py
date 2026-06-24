"""
Safe interpolation for pre-CD model % nodes (model_dm*).

Does not flat-fill from a single anchor (e.g. T-60 = 0%) across the whole curve.
Blend strutturale opzionale: ``PRED_DM_STRUCT_BLEND*`` in ``prediction.config``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PRE_CD_GRID: tuple[tuple[int, str], ...] = (
    (-60, "model_dm60_pct"),
    (-30, "model_dm30_pct"),
    (-10, "model_dm10_pct"),
    (-7, "model_dm7_pct"),
    (-5, "model_dm5_pct"),
    (-3, "model_dm3_pct"),
)

_JSON_CURVE_SEED_PAIRS: tuple[tuple[str, str], ...] = (
    ("d3_pct", "model_d3_pct"),
    ("d5_pct", "model_d5_pct"),
    ("d10_pct", "model_d10_pct"),
    ("d30_pct", "model_d30_pct"),
    ("model_d3_pct", "d3_pct"),
    ("model_d5_pct", "d5_pct"),
    ("model_d10_pct", "d10_pct"),
    ("model_d30_pct", "d30_pct"),
)

_IMPUTE_CAP_PP = 25.0


@dataclass(frozen=True)
class ImputeResult:
    imputed: bool
    nodes_used: int
    reason: str | None = None
    debug_note: str | None = None


def parse_pct(v: Any) -> float | None:
    """Parse % field (stub / JSON / Simulation)."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, str):
        s = v.strip().replace("%", "").replace(",", ".")
        if not s or s.lower() in ("—", "-", "n/d", "tbd", "nan"):
            return None
        try:
            x = float(s)
        except ValueError:
            return None
    else:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
    return x if x == x else None


_POST_CD_MODEL_KEYS = ("model_d4_pct", "model_d7_pct")


def count_post_cd_model_nodes(row: dict) -> int:
    n = 0
    for k in _POST_CD_MODEL_KEYS:
        if parse_pct(row.get(k)) is not None:
            n += 1
    return n


def count_pre_cd_nodes(row: dict) -> tuple[int, int]:
    """Return (node_count, distinct_value_count) for pre-CD model_dm* keys."""
    nodes: list[tuple[int, float]] = []
    for off, key in PRE_CD_GRID:
        v = parse_pct(row.get(key))
        if v is not None:
            nodes.append((off, float(v)))
    if not nodes:
        return 0, 0
    # Single anchor T-60 = 0% must not unlock interpolation (weakness #6).
    if len(nodes) == 1 and nodes[0][0] == -60 and abs(nodes[0][1]) < 1e-9:
        return 1, 1
    return len(nodes), len({round(v, 6) for _, v in nodes})


def seed_nodes_from_json_aliases(row: dict) -> int:
    """Fill missing model/d % from sibling keys on the same JSON record."""
    if not isinstance(row, dict):
        return 0
    n = 0
    for src, dst in _JSON_CURVE_SEED_PAIRS:
        if parse_pct(row.get(dst)) is not None:
            continue
        v = parse_pct(row.get(src))
        if v is None:
            continue
        row[dst] = round(max(-_IMPUTE_CAP_PP, min(_IMPUTE_CAP_PP, float(v))), 1)
        n += 1
    return n


def try_direction_curve_from_record(row: dict) -> bool:
    """
    If direction and at least one curve % exist on the record, align curve sign
    to direction (same policy as live pipeline reconcile scale).
    """
    if not isinstance(row, dict):
        return False
    dir_lbl = (
        row.get("direction_label")
        or row.get("dir_v4")
        or row.get("direction")
    )
    if not dir_lbl:
        return False
    try:
        from prediction.reconcile import (
            CURVE_PCT_KEYS,
            _apply_scale,
            _contradicts,
            curve_direction_implied,
            label_polarity,
        )
    except ImportError:
        return False

    scratch: dict[str, Any] = {}
    for k in CURVE_PCT_KEYS:
        v = parse_pct(row.get(k))
        if v is not None:
            scratch[k] = float(v)
    if not scratch:
        return False

    try:
        from prediction.config import get_config

        _eps = float(get_config().pred_curve_align_epsilon)
    except Exception:
        _eps = 0.5
    dir_pol = label_polarity(str(dir_lbl))
    curve_pol, _ = curve_direction_implied(scratch, epsilon=_eps)
    if not _contradicts(dir_pol, curve_pol):
        return False

    _apply_scale(scratch, dir_pol)
    for k, v in scratch.items():
        if v is not None:
            row[k] = round(max(-_IMPUTE_CAP_PP, min(_IMPUTE_CAP_PP, float(v))), 1)
    return True


def impute_pre_cd_gaps_only(row: dict, *, cap_pp: float = _IMPUTE_CAP_PP) -> ImputeResult:
    """
    Fill missing pre-CD grid points on the line through the earliest and latest
    known anchors (interpolation and extrapolation). Requires two distinct nodes;
    no fill from a single anchor (e.g. lone T-60 = 0%).
    """
    if not isinstance(row, dict):
        return ImputeResult(False, 0, reason="invalid_row")

    offs = [o for o, _ in PRE_CD_GRID]
    ky_by = dict(PRE_CD_GRID)
    v: dict[int, float | None] = {o: parse_pct(row.get(ky_by[o])) for o in offs}

    n_nodes, n_distinct = count_pre_cd_nodes(row)
    if n_nodes == 0:
        return ImputeResult(False, 0, reason="no_nodes")
    if n_nodes < 2 or n_distinct < 2:
        return ImputeResult(
            False,
            n_nodes,
            reason="insufficient_nodes",
            debug_note=f"[impute: skip, {n_nodes} node{'s' if n_nodes != 1 else ''}]",
        )

    known = sorted((o, float(v[o])) for o in offs if v[o] is not None)
    o0, v0 = known[0]
    o1, v1 = known[-1]
    if o0 == o1:
        return ImputeResult(
            False,
            n_nodes,
            reason="insufficient_nodes",
            debug_note=f"[impute: skip, {n_nodes} nodes]",
        )

    filled = 0
    for off in offs:
        if v[off] is not None:
            continue
        nv = v0 + (v1 - v0) * float(off - o0) / float(o1 - o0)
        nv = round(max(-cap_pp, min(cap_pp, nv)), 1)
        row[ky_by[off]] = nv
        v[off] = nv
        filled += 1

    if filled == 0:
        if n_nodes >= 2 and n_distinct >= 2:
            return ImputeResult(
                False,
                n_nodes,
                reason="complete",
                debug_note=f"[impute: complete, {n_nodes} nodes]",
            )
        return ImputeResult(
            False,
            n_nodes,
            reason="insufficient_nodes",
            debug_note=f"[impute: skip, {n_nodes} nodes]",
        )
    n_after, _ = count_pre_cd_nodes(row)
    return ImputeResult(
        True,
        n_after,
        reason=None,
        debug_note=f"[impute: ok, {n_after} nodes]",
    )


def set_model_curve_flags(row: dict, result: ImputeResult) -> None:
    """Write imputation metadata on the record / grafici accum dict."""
    if not isinstance(row, dict):
        return
    row["model_curve_imputed"] = bool(result.imputed)
    row["model_curve_impute_nodes"] = int(result.nodes_used)
    row["model_imputed"] = bool(result.imputed)
    if result.imputed or result.reason == "complete":
        row["model_impute_reason"] = None
        row["model_curve_valid"] = True
    else:
        row["model_impute_reason"] = result.reason or "insufficient_nodes"
        row["model_curve_valid"] = False
    if result.debug_note:
        row["model_impute_debug_note"] = result.debug_note


def model_curve_is_plottable(row: dict | None) -> bool:
    """
    True se la curva può essere interpolata per Accuracy/Simulation.

    Basta ≥1 nodo post‑CD (``model_d4``/``model_d7``) oppure ≥2 nodi pre‑CD distinti;
    un solo ``model_dm60_pct``=0 **non** basta da solo, ma con post‑CD sì.
    """
    if not isinstance(row, dict):
        return False
    if count_post_cd_model_nodes(row) >= 1:
        return True
    n, d = count_pre_cd_nodes(row)
    if n >= 2 and d >= 2:
        return True
    if row.get("model_curve_valid") is False:
        return False
    if str(row.get("model_impute_reason") or "") == "insufficient_nodes":
        return False
    return n >= 1


def impute_pre_cd_model_pcts(row: dict) -> ImputeResult:
    """
    Full safe imputation pass: seed JSON aliases, optional direction align, gap fill.
    Call after overlay from Simulation and post-CD node synthesis.
    """
    if not isinstance(row, dict):
        return ImputeResult(False, 0, reason="invalid_row")

    seed_nodes_from_json_aliases(row)
    try_direction_curve_from_record(row)

    result = impute_pre_cd_gaps_only(row)
    if not result.imputed:
        seed_nodes_from_json_aliases(row)
        try_direction_curve_from_record(row)
        result = impute_pre_cd_gaps_only(row)

    set_model_curve_flags(row, result)
    return result


__all__ = [
    "PRE_CD_GRID",
    "ImputeResult",
    "count_pre_cd_nodes",
    "impute_pre_cd_gaps_only",
    "impute_pre_cd_model_pcts",
    "model_curve_is_plottable",
    "parse_pct",
    "seed_nodes_from_json_aliases",
    "set_model_curve_flags",
    "try_direction_curve_from_record",
]
