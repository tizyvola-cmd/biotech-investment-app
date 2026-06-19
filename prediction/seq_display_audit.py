"""
Audit errori di visualizzazione curva Pred su Simulation / Accuracy (futuro).

Codici principali
-----------------
seq_runup_anchoring
    «Ancoraggio al run-up già prezzato» — la seq_curve replica il rally
    (seq >> modello v4 su orizzonti pre-CD). Caso tipico: HURA.

seq_flatline_plateau
  «Plateau seq» — dopo un salto, la seq resta quasi piatta (+43,8%, +43,9%, …)
  mentre il modello segue un'altra traiettoria.

pred_display_incomplete
    Celle «—» perché mancano seq, nodi model_dm* o prezzo T−60.
"""
from __future__ import annotations

import os
import statistics
from typing import Any

# Codici errore (log, JSON audit, documentazione)
SEQ_RUNUP_ANCHORING = "seq_runup_anchoring"
SEQ_FLATLINE_PLATEAU = "seq_flatline_plateau"
PRED_DISPLAY_INCOMPLETE = "pred_display_incomplete"

_LABEL_IT = {
    SEQ_RUNUP_ANCHORING: "Ancoraggio al run-up (seq ≫ modello)",
    SEQ_FLATLINE_PLATEAU: "Plateau seq (curva piatta post-rally)",
    PRED_DISPLAY_INCOMPLETE: "Δ% Pred incompleti (nodi/prezzo mancanti)",
}


def display_audit_enabled() -> bool:
    return os.environ.get("SIMULATION_DISPLAY_AUDIT", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _run_up_pp(pred_row: dict | None) -> float | None:
    if not isinstance(pred_row, dict):
        return None
    for k in ("run_up_30d", "runup_30d", "run_up"):
        v = _float_or_none(pred_row.get(k))
        if v is not None:
            return v
    return None


def detect_seq_flatline_plateau(
    seq_pts: list[float | None],
    *,
    start_i: int = 1,
    end_i: int = 7,
    min_level_pp: float = 8.0,
    max_std_pp: float = 1.25,
) -> bool:
    """True se la seq è quasi costante su più orizzonti dopo un livello elevato (pattern HURA)."""
    vals = [
        float(seq_pts[i])
        for i in range(start_i, min(end_i, len(seq_pts)))
        if i < len(seq_pts) and _float_or_none(seq_pts[i]) is not None
    ]
    if len(vals) < 3:
        return False
    if statistics.mean(abs(v) for v in vals) < min_level_pp:
        return False
    if len(vals) < 2:
        return False
    return statistics.pstdev(vals) <= max_std_pp


def detect_seq_runup_anchoring(
    seq_pts: list[float | None],
    model_pts: list[float | None],
    *,
    pred_row: dict | None = None,
    gap_pp: float | None = None,
    pre_cd_indices: tuple[int, ...] = (1, 2, 3, 4, 5),
) -> dict[str, Any] | None:
    """
    Rileva quando la seq supera di molto il modello su orizzonti pre-evento
    (rumore / buy-the-rumor già nel prezzo).
    """
    if gap_pp is None:
        try:
            gap_pp = float(
                os.environ.get("SIMULATION_SEQ_MODEL_GAP_PP", "12").strip() or "12"
            )
        except ValueError:
            gap_pp = 12.0
    worst_i = None
    worst_gap = 0.0
    for i in pre_cd_indices:
        if i >= len(seq_pts) or i >= len(model_pts):
            continue
        sq = _float_or_none(seq_pts[i])
        mq = _float_or_none(model_pts[i])
        if sq is None or mq is None:
            continue
        g = sq - mq
        if g > worst_gap:
            worst_gap = g
            worst_i = i
    if worst_gap < float(gap_pp):
        return None
    ru = _run_up_pp(pred_row)
    return {
        "code": SEQ_RUNUP_ANCHORING,
        "label_it": _LABEL_IT[SEQ_RUNUP_ANCHORING],
        "worst_index": worst_i,
        "gap_pp": round(worst_gap, 1),
        "run_up_30d": ru,
    }


def audit_pred_display_curve(
    seq_pts: list[float | None] | None,
    model_pts: list[float | None] | None,
    display_pts: list[float | None] | None,
    *,
    pred_row: dict | None = None,
    row_key: str | None = None,
) -> dict[str, Any]:
    """Ritorna ``issues`` (lista codici), ``labels_it``, dettagli per log."""
    seq_pts = list(seq_pts or [])
    model_pts = list(model_pts or [])
    display_pts = list(display_pts or [])
    issues: list[dict[str, Any]] = []

    missing = sum(1 for x in display_pts if _float_or_none(x) is None)
    if missing > 0:
        issues.append({
            "code": PRED_DISPLAY_INCOMPLETE,
            "label_it": _LABEL_IT[PRED_DISPLAY_INCOMPLETE],
            "missing_cells": missing,
            "total_cells": len(display_pts),
        })

    if seq_pts and model_pts:
        ru_info = detect_seq_runup_anchoring(seq_pts, model_pts, pred_row=pred_row)
        if ru_info:
            issues.append(ru_info)
        if detect_seq_flatline_plateau(seq_pts):
            issues.append({
                "code": SEQ_FLATLINE_PLATEAU,
                "label_it": _LABEL_IT[SEQ_FLATLINE_PLATEAU],
            })

    out: dict[str, Any] = {
        "row_key": row_key,
        "issues": issues,
        "codes": [x["code"] for x in issues],
        "labels_it": [x["label_it"] for x in issues],
    }
    return out


def format_audit_log_line(audit: dict[str, Any]) -> str:
    rk = audit.get("row_key") or "?"
    codes = audit.get("codes") or []
    if not codes:
        return ""
    parts = [f"[Simulation][display-audit] {rk}: " + ", ".join(codes)]
    for iss in audit.get("issues") or []:
        if iss.get("code") == SEQ_RUNUP_ANCHORING:
            parts.append(
                f"  → gap seq−model max {iss.get('gap_pp')} pp"
                f"{'' if iss.get('run_up_30d') is None else f', run_up_30d={iss.get('run_up_30d')}%'} "
                f"(correzione: blend verso modello v4)"
            )
        elif iss.get("code") == SEQ_FLATLINE_PLATEAU:
            parts.append(
                "  → seq quasi piatta su più orizzonti (correzione: curva modello in tabella)"
            )
        elif iss.get("code") == PRED_DISPLAY_INCOMPLETE:
            parts.append(
                f"  → {iss.get('missing_cells')}/{iss.get('total_cells')} celle «—» "
                f"(verificare pred live, model_dm*, seq_curve, Prezzo T−60)"
            )
    return "\n".join(parts)


def plateau_forces_model_display() -> bool:
    return os.environ.get("SIMULATION_SEQ_PLATEAU_USE_MODEL", "0").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
