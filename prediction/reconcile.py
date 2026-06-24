"""
Riconciliazione direzione ensemble ↔ curva precatalizzatore (model_dm* / d*).

Politica (default ``hybrid``, env ``PRED_CURVE_ALIGN_MODE``):
- mismatch moderato: scala/flip le % mantenendo forma relativa (come Excel storico);
- mismatch forte: declassa la label direzionale e abbassa confidence;
- caso allineato: nessuna modifica.

Non tocca righe retro/backtest: solo chiamata dal pipeline live prima del save.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from prediction.config import get_config
from prediction.types import DirectionResult

# Chiavi % aggiornate in-place sul dict passato dal pipeline
CURVE_PCT_KEYS: tuple[str, ...] = (
    "model_dm7_pct",
    "model_dm5_pct",
    "model_dm3_pct",
    "model_dm10_pct",
    "model_dm30_pct",
    "model_dm60_pct",
    "d3_pct",
    "d5_pct",
    "d10_pct",
    "d30_pct",
    "model_d4_pct",
    "model_d7_pct",
)

# Pesi orizzonti per segnale curva (end-to-end precat → post-T)
_CURVE_WEIGHTS: tuple[tuple[str, float], ...] = (
    ("model_dm60_pct", 0.40),
    ("model_dm30_pct", 0.30),
    ("model_dm10_pct", 0.20),
    ("d30_pct", 0.10),
)

_LABEL_DOWNGRADE: dict[str, str] = {
    "↑↑ Forte crescita": "↑ Crescita lieve",
    "↑ Crescita lieve": "→ Stabile",
    "↓↓ Calo forte": "↓ Calo lieve",
    "↓ Calo lieve": "→ Stabile",
}


@dataclass
class CurveAlignConfig:
    """Opzioni riconciliazione (default da env se omesso)."""
    epsilon: float | None = None
    mode: str | None = None
    strong_pp: float | None = None


@dataclass
class ReconcileOutcome:
    direction_result: DirectionResult
    model_pcts: dict[str, Any]
    direction_curve_aligned: bool = True
    direction_curve_mismatch: str | None = None
    curve_direction_implied: str = "flat"
    reconcile_action: str | None = None


def _cfg(config: CurveAlignConfig | None) -> tuple[float, str, float]:
    cfg = get_config()
    eps = config.epsilon if config and config.epsilon is not None else cfg.pred_curve_align_epsilon
    mode = (config.mode if config and config.mode else cfg.pred_curve_align_mode).strip().lower()
    if mode not in ("scale", "downgrade", "hybrid"):
        mode = "hybrid"
    strong = (
        config.strong_pp
        if config and config.strong_pp is not None
        else cfg.pred_curve_align_strong_pp(eps)
    )
    return eps, mode, strong


def label_polarity(label: str) -> str:
    """``bull`` | ``bear`` | ``flat`` | ``unknown`` da label italiana."""
    if not label:
        return "unknown"
    if label.startswith("↑"):
        return "bull"
    if label.startswith("↓"):
        return "bear"
    if label.startswith("→"):
        return "flat"
    return "unknown"


def curve_direction_implied(model_pcts: dict[str, Any], *, epsilon: float) -> tuple[str, float | None]:
    """
  ``up`` | ``down`` | ``flat`` e media pesata disponibile (% punti).
    """
    num = 0.0
    den = 0.0
    for key, w in _CURVE_WEIGHTS:
        v = model_pcts.get(key)
        if v is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        num += w * fv
        den += w
    if den <= 0:
        # fallback: solo model_dm60 se presente
        v60 = model_pcts.get("model_dm60_pct")
        if v60 is None:
            return "flat", None
        try:
            s = float(v60)
        except (TypeError, ValueError):
            return "flat", None
        if s > epsilon:
            return "up", s
        if s < -epsilon:
            return "down", s
        return "flat", s
    avg = num / den
    if avg > epsilon:
        return "up", avg
    if avg < -epsilon:
        return "down", avg
    return "flat", avg


def _contradicts(dir_pol: str, curve_pol: str) -> bool:
    if dir_pol == "bull" and curve_pol == "down":
        return True
    if dir_pol == "bear" and curve_pol == "up":
        return True
    if dir_pol == "flat" and curve_pol in ("up", "down"):
        return True
    if dir_pol == "bull" and curve_pol == "flat":
        return True
    if dir_pol == "bear" and curve_pol == "flat":
        return True
    return False


def _scale_value(v: float | None, *, bull_dir: bool, stable: bool) -> float | None:
    """Allinea segno singolo orizzonte (stessa semantica del vecchio pipeline)."""
    if v is None:
        return None
    if stable:
        return round(v * 0.35, 1)
    if bull_dir and v < 0:
        return round(-v * 0.4, 1)
    if not bull_dir and v > 0:
        return round(-v * 0.7, 1)
    return v


def _apply_scale(model_pcts: dict[str, Any], dir_pol: str) -> None:
    bull = dir_pol == "bull"
    bear = dir_pol == "bear"
    stable = dir_pol == "flat"
    if not (bull or bear or stable):
        return
    for k in CURVE_PCT_KEYS:
        if k not in model_pcts:
            continue
        model_pcts[k] = _scale_value(model_pcts.get(k), bull_dir=bull, stable=stable)


def _downgrade_label(label: str) -> str:
    return _LABEL_DOWNGRADE.get(label, label)


def reconcile_direction_and_curve(
    direction_result: DirectionResult,
    model_pcts: dict[str, Any],
    config: CurveAlignConfig | None = None,
) -> ReconcileOutcome:
    """
    Allinea direzione e curva se in contraddizione; arricchisce metadati per il record JSON.

    ``model_pcts`` viene mutato in-place quando serve scaling.
    """
    eps, mode, strong_pp = _cfg(config)
    curve_pol, signal = curve_direction_implied(model_pcts, epsilon=eps)
    dir_pol = label_polarity(direction_result.direction_label)

    aligned = not _contradicts(dir_pol, curve_pol)
    mismatch_note: str | None = None
    action: str | None = None
    dr = direction_result

    if aligned:
        return ReconcileOutcome(
            direction_result=dr,
            model_pcts=model_pcts,
            direction_curve_aligned=True,
            direction_curve_mismatch=None,
            curve_direction_implied=curve_pol,
            reconcile_action=None,
        )

    sig_abs = abs(signal) if signal is not None else 0.0
    strong = sig_abs >= strong_pp
    mismatch_note = (
        f"dir={dir_pol} label={direction_result.direction_label!r} "
        f"vs curva={curve_pol} (segno pesato={signal:+.2f}% segnale)"
        if signal is not None
        else f"dir={dir_pol} label={direction_result.direction_label!r} vs curva={curve_pol}"
    )

    do_scale = mode == "scale" or (mode == "hybrid" and not strong)
    do_downgrade = mode == "downgrade" or (mode == "hybrid" and strong)

    if do_scale:
        _apply_scale(model_pcts, dir_pol)
        action = "scale"
        # Ricalcola curva dopo scaling
        curve_pol, signal = curve_direction_implied(model_pcts, epsilon=eps)
        if not _contradicts(dir_pol, curve_pol):
            conf = max(0.05, round(dr.confidence * 0.88, 3))
            notes = list(dr.notes) + [f"riconcilia curva ({action})"]
            dr = replace(dr, confidence=conf, notes=notes)
            return ReconcileOutcome(
                direction_result=dr,
                model_pcts=model_pcts,
                direction_curve_aligned=True,
                direction_curve_mismatch=mismatch_note,
                curve_direction_implied=curve_pol,
                reconcile_action=action,
            )

    if do_downgrade:
        new_label = _downgrade_label(dr.direction_label)
        action = "downgrade"
        conf = max(0.05, round(dr.confidence * (0.65 if strong else 0.78), 3))
        notes = list(dr.notes) + [
            f"riconcilia dir ({action}): {dr.direction_label}→{new_label}",
        ]
        dr = replace(
            dr,
            direction_label=new_label,
            confidence=conf,
            notes=notes,
        )
        # Dopo downgrade a neutro, comprimi curva se ancora estrema
        new_pol = label_polarity(new_label)
        if new_pol == "flat":
            _apply_scale(model_pcts, "flat")
            curve_pol, _ = curve_direction_implied(model_pcts, epsilon=eps)
        aligned_after = not _contradicts(label_polarity(new_label), curve_pol)
        return ReconcileOutcome(
            direction_result=dr,
            model_pcts=model_pcts,
            direction_curve_aligned=aligned_after,
            direction_curve_mismatch=mismatch_note if not aligned_after else mismatch_note,
            curve_direction_implied=curve_pol,
            reconcile_action=action,
        )

    # mode scale ma ancora in contrasto senza downgrade (non dovrebbe in hybrid)
    return ReconcileOutcome(
        direction_result=dr,
        model_pcts=model_pcts,
        direction_curve_aligned=False,
        direction_curve_mismatch=mismatch_note,
        curve_direction_implied=curve_pol,
        reconcile_action=action,
    )
