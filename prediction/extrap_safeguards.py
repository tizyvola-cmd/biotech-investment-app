"""
Safeguards for precatalyst polynomial extrapolation (all tickers).

- Long-horizon ``model_dm60_pct`` dampening when R² is low or run-up is elevated.
- Final ±cap after post-hoc / struct blend (those steps can push values past the cap).
"""
from __future__ import annotations

import os

PRED_PCT_FIELD_KEYS: tuple[str, ...] = (
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


def pred_cap_abs_pp() -> float:
    """Cap |%| su orizzonti post-CD (``d*``, ``model_d*``)."""
    try:
        return float(os.environ.get("PRED_CAP_ABS_PP", "25").strip() or "25")
    except ValueError:
        return 25.0


def pred_stn_runup_threshold() -> float:
    """
    Soglia run_up_30d (%) oltre cui scatta la correzione sell-the-news post-CD.

    Analisi storica su 7.5k eventi: bias per bucket run_up —
      0-5%  → -2.7pp (neutro), 5-15% → -11pp, 15-30% → -21pp, >30% → -69pp.
    Default 15: la correzione scatta solo dove il bias è già forte (>15%),
    evitando la compressione eccessiva sui titoli con run-up moderato.

    Override: ``PRED_STN_RUNUP_THRESHOLD=<float>``  (precedente valore hardcodato: 5.0)
    """
    try:
        return float(os.environ.get("PRED_STN_RUNUP_THRESHOLD", "15").strip() or "15")
    except ValueError:
        return 15.0


def pred_dir_align_flip_factor() -> float:
    """
    Fattore di flip direzione-curva: quando direction=↓ e curva > 0,
    la % positiva viene capovolta a negativa moltiplicando per questo fattore.

    Analisi storica: direction ↓↓ ha bias -27.9pp (troppo pessimista).
    Default 0.5 (era 0.7 hardcodato): riduce il flip senza eliminarlo,
    mantenendo il segnale direzionale ma attenuando la sovra-penalizzazione.

    Override: ``PRED_DIR_ALIGN_FLIP_FACTOR=<float>``  (precedente valore: 0.7)
    """
    try:
        v = float(os.environ.get("PRED_DIR_ALIGN_FLIP_FACTOR", "0.5").strip() or "0.5")
        return max(0.1, min(1.0, v))
    except ValueError:
        return 0.5


def pred_cap_abs_pp_precd() -> float:
    """Cap |%| su orizzonti pre-CD (``model_dm*``); default più permissivo."""
    from prediction.curve_display import pred_cap_abs_pp_precd as _precd_cap

    return _precd_cap()


def pred_damp_dm60_extrap_enabled() -> bool:
    """Estrapolazione dm60 verso dm30 / run-up (default off = curva pre-CD meno compressa)."""
    return os.environ.get("PRED_DAMP_DM60_EXTRAP", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def cap_pred_pct(v: float | None, cap: float | None = None) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x != x:
        return None
    c = pred_cap_abs_pp() if cap is None else float(cap)
    return round(max(-c, min(c, x)), 1)


def extrap_runup_threshold_pp() -> float:
    try:
        return float(os.environ.get("PRED_EXTRAP_MAX_RUNUP", "15").strip() or "15")
    except ValueError:
        return 15.0


def damp_model_dm60_extrap(
    dm60: float | None,
    dm30: float | None,
    *,
    best_r2: float | None,
    run_up_30d: float | None,
    days_to_t: int | None,
) -> float | None:
    """
    Shrink ``model_dm60_pct`` toward ``model_dm30_pct`` when the precat fit is weak
    (low R²) and/or the name has already run up (buy-the-rumor).
    """
    if dm60 is None:
        return None
    try:
        out = float(dm60)
    except (TypeError, ValueError):
        return None
    if out != out:
        return None

    r2_thr = 0.45
    if best_r2 is not None and float(best_r2) < r2_thr and dm30 is not None:
        try:
            dm30f = float(dm30)
        except (TypeError, ValueError):
            dm30f = None
        if dm30f is not None and dm30f == dm30f:
            w = max(0.0, min(1.0, (r2_thr - float(best_r2)) / 0.25))
            if days_to_t is not None and int(days_to_t) > 30:
                w = min(1.0, w * 1.25)
            out = out * (1.0 - w) + dm30f * w

    ru_thr = extrap_runup_threshold_pp()
    if run_up_30d is not None and float(run_up_30d) > ru_thr and out > 0:
        rev = min(0.55, float(run_up_30d) / 60.0)
        if days_to_t is not None and int(days_to_t) <= 14:
            rev = min(0.65, rev + 0.1)
        out = out * (1.0 - rev)

    return round(out, 1)


def finalize_pred_pct_fields(row: dict, *, cap: float | None = None) -> None:
    """Re-apply symmetric cap on horizon % fields (in-place)."""
    if not isinstance(row, dict):
        return
    for k in PRED_PCT_FIELD_KEYS:
        if k in row:
            row[k] = cap_pred_pct(row.get(k), cap)


def sheet_seq_blend_to_model_enabled(*, accuracy: bool = False) -> bool:
    """
    When seq is shown on Simulation/Accuracy, shrink toward model if seq >> model (run-up).

    Accuracy default **off** (``ACCURACY_SEQ_BLEND_TO_MODEL=0``): audit storico deve
    riflettere close reali, non il modello piatto.
    """
    key = "ACCURACY_SEQ_BLEND_TO_MODEL" if accuracy else "SIMULATION_SEQ_BLEND_TO_MODEL"
    default = "0"
    return os.environ.get(key, default).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _seq_model_gap_threshold_pp() -> float:
    try:
        return float(
            os.environ.get("SIMULATION_SEQ_MODEL_GAP_PP", "12").strip() or "12"
        )
    except ValueError:
        return 12.0


def _round_seq_display_pct(v: float | None) -> float | None:
    """% da close reali su foglio: senza cap simmetrico (run-up +90% ammesso)."""
    if v is None:
        return None
    try:
        x = float(v)
        return round(x, 2) if x == x else None
    except (TypeError, ValueError):
        return None


def _model_display_cap(*, accuracy: bool = False, cap: float | None = None) -> float | None:
    if cap is not None:
        return cap
    if accuracy:
        try:
            return float(
                os.environ.get("ACCURACY_PRED_CAP_ABS_PP", "200").strip() or "200"
            )
        except ValueError:
            return 200.0
    return None


def blend_sheet_display_seq_model(
    seq_pts: list[float | None],
    model_pts: list[float | None],
    *,
    accuracy: bool = False,
    pred_row: dict | None = None,
    cap: float | None = None,
    row_key: str | None = None,
    log_audit: bool = True,
) -> list[float | None]:
    """
    Display curve for sheets: **seq** (market-anchored) unless it overshoots **model**
    on an horizon — then blend toward model (rumore / run-up già nel prezzo).

    Evita casi tipo HURA (+40% seq vs ~0% model) senza tornare al solo modello puro.
    Audit: ``prediction.seq_display_audit`` (codice ``seq_runup_anchoring``).
    """
    n = max(len(seq_pts or []), len(model_pts or []))
    if n == 0:
        return []
    _mcap = _model_display_cap(accuracy=accuracy, cap=cap)

    if not sheet_seq_blend_to_model_enabled(accuracy=accuracy):
        out: list[float | None] = []
        for i in range(n):
            sq = seq_pts[i] if i < len(seq_pts) else None
            mq = model_pts[i] if i < len(model_pts) else None
            if sq is not None:
                out.append(_round_seq_display_pct(sq))
            else:
                out.append(cap_pred_pct(mq, _mcap))
        return out
    else:
        from prediction.seq_display_audit import (
            audit_pred_display_curve,
            detect_seq_flatline_plateau,
            display_audit_enabled,
            format_audit_log_line,
            plateau_forces_model_display,
        )

        if plateau_forces_model_display() and detect_seq_flatline_plateau(seq_pts):
            out = [
                cap_pred_pct(model_pts[i] if i < len(model_pts) else None, _mcap)
                for i in range(n)
            ]
        else:
            gap_thr = _seq_model_gap_threshold_pp()
            run_up: float | None = None
            if isinstance(pred_row, dict):
                for _k in ("run_up_30d", "runup_30d", "run_up"):
                    _rv = pred_row.get(_k)
                    if _rv is None:
                        continue
                    try:
                        run_up = float(_rv)
                        if run_up == run_up:
                            break
                    except (TypeError, ValueError):
                        continue

            out = []
            for i in range(n):
                sq = seq_pts[i] if i < len(seq_pts) else None
                mq = model_pts[i] if i < len(model_pts) else None
                if sq is None:
                    out.append(cap_pred_pct(mq, _mcap))
                    continue
                if mq is None:
                    out.append(_round_seq_display_pct(sq))
                    continue
                try:
                    sf = float(sq)
                    mf = float(mq)
                except (TypeError, ValueError):
                    out.append(_round_seq_display_pct(sq))
                    continue
                if sf != sf or mf != mf:
                    out.append(_round_seq_display_pct(sq))
                    continue

                blended = sf
                if sf > mf + gap_thr:
                    excess = sf - mf
                    ru = max(0.0, float(run_up)) if run_up is not None else 0.0
                    w = min(
                        0.88,
                        0.30 + excess / 70.0
                        + max(0.0, ru - extrap_runup_threshold_pp()) / 70.0,
                    )
                    blended = sf * (1.0 - w) + mf * w
                elif sf < mf - gap_thr:
                    excess = mf - sf
                    w = min(0.75, 0.22 + excess / 80.0)
                    blended = sf * (1.0 - w) + mf * w
                out.append(cap_pred_pct(blended, _mcap))

        if (
            log_audit
            and display_audit_enabled()
            and row_key
            and os.environ.get("SIMULATION_DISPLAY_AUDIT_LOG_EACH", "").strip().lower()
            in ("1", "true", "yes", "on")
        ):
            audit = audit_pred_display_curve(
                seq_pts, model_pts, out, pred_row=pred_row, row_key=row_key,
            )
            line = format_audit_log_line(audit)
            if line:
                print(line, flush=True)

    return out


def sheet_use_seq_curve_for_pred(*, accuracy: bool = False) -> bool:
    """
    Default **on**: colonne Δ% Pred da ``seq_curve_pct_vs_m60`` (passato = close reali,
    futuro = ultimo reale + incremento modello v4).

    Opt-out: ``SIMULATION_SHEET_USE_MODEL_ONLY=1`` / ``ACCURACY_SHEET_USE_MODEL_ONLY=1``.
    Legacy: ``*_USE_SEQ_CURVE=0`` forza modello; ``=1`` forza seq anche se opt-out.
    """
    if accuracy:
        seq_key = "ACCURACY_SHEET_USE_SEQ_CURVE"
        model_only_key = "ACCURACY_SHEET_USE_MODEL_ONLY"
    else:
        seq_key = "SIMULATION_SHEET_USE_SEQ_CURVE"
        model_only_key = "SIMULATION_SHEET_USE_MODEL_ONLY"
    raw = os.environ.get(seq_key, "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    if os.environ.get(model_only_key, "").strip().lower() in (
        "1", "true", "yes", "on",
    ):
        return False
    return True
