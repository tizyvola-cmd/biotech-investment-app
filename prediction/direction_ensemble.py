"""
Direction ensemble v4.1 — post-catalyst direction from technical + options signals.

Rispetto a v4: niente neutro forzato in Fase 2; confidence da |net| e copertura dati;
output strutturato opzionale (``DirectionResult``).
"""
from __future__ import annotations

import math
import os
import time
from typing import overload

from prediction.calibration import direction_calib_multiplier
from prediction.config import pred_dir_fund_penalty_enabled
from prediction.phase_pos import phase_pos_score, phase_pos_label
from prediction.types import DirectionResult

# ── Calibrazione adattiva slope5d (da slope_contrarian_calib.json) ────────────
# Il peso viene letto una volta per processo (TTL 10 min) e applicato ai punti
# s5d in _accumulate_scores. Default 1.0 se il file non esiste ancora.
_S5D_W_CACHE: tuple[float, float] | None = None   # (weight, monotonic_ts)
_S5D_W_TTL = 600.0   # secondi


def _load_s5d_weight() -> float:
    """Carica il peso calibrato per il segnale slope5d (cache 10 min)."""
    global _S5D_W_CACHE
    now = time.monotonic()
    if _S5D_W_CACHE is not None and (now - _S5D_W_CACHE[1]) < _S5D_W_TTL:
        return _S5D_W_CACHE[0]
    try:
        env_path = os.environ.get("SLOPE_CONTRARIAN_CALIB_PATH", "").strip()
        path = env_path or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "data", "slope_contrarian_calib.json",
        )
        if os.path.isfile(path):
            import json as _json
            with open(path, "r", encoding="utf-8") as _f:
                _d = _json.load(_f)
            w = float(_d.get("combined_s5d_weight", 1.0))
            w = max(0.5, min(2.0, w))
            _S5D_W_CACHE = (w, now)
            return w
    except Exception:
        pass
    _S5D_W_CACHE = (1.0, now)
    return 1.0


def invalidate_s5d_weight_cache() -> None:
    """Forza il ricaricamento del peso alla prossima chiamata (es. dopo run calibrazione)."""
    global _S5D_W_CACHE
    _S5D_W_CACHE = None


# Soglie net per label direzionale (|net| vs bull−bear)
_NET_MILD = 3
_NET_STRONG = 4
# Fase 2: storico ~70% fail → attenuazione punteggi + soglia più alta
_PH2_SCORE_FACTOR = 0.75
_PH2_NET_MILD = 4
_PH2_NET_STRONG = 5
# Soglie temporali adattive: più lontano dal catalyst → net score più alto richiesto.
# Analisi storica (4919 record): segnali tecnici hanno phi~0 → call direzionali a T>15gg
# sono essenzialmente casuali (49.4% hit%). Soluzione: alzare soglia proporzionalmente.
_DAYS_MID_THRESHOLD = 15   # T>15gg: mild += 1 (da 3 a 4) → richiede consenso più forte
_DAYS_FAR_THRESHOLD = 30   # T>30gg: mild += 2 (da 3 a 5) → quasi sempre Stabile

_TRUTHY_ON = frozenset({"1", "true", "yes", "on"})


def _env_truthy(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def pred_dir_fund_penalty_enabled() -> bool:
    """``PRED_DIR_FUND_PENALTY=1`` — confidence penalties from beta / liquidity."""
    return _env_truthy("PRED_DIR_FUND_PENALTY", "0")


def pred_dir_fund_liq_threshold() -> float:
    try:
        return float(os.environ.get("PRED_DIR_FUND_LIQ_THRESHOLD", "0.65").strip() or "0.65")
    except ValueError:
        return 0.65


def _is_bullish_strong_label(direction_label: str) -> bool:
    d = str(direction_label or "")
    return d.startswith("↑") or "crescita" in d.lower()


def apply_direction_fundamental_penalties(
    confidence: float,
    direction_label: str,
    net_score: int,
    *,
    liquidity_score: float | None = None,
    beta: float | None = None,
    liq_threshold: float | None = None,
    enabled: bool | None = None,
) -> tuple[float, int, int]:
    """
    Reduce ``direction_confidence`` for illiquid / high-beta names; never flip sign.

    Returns ``(confidence, dir_liquidity_risk, dir_beta_risk)`` with risk flags 0/1.
    """
    if enabled is None:
        enabled = pred_dir_fund_penalty_enabled()
    if not enabled:
        return confidence, 0, 0

    conf = float(confidence)
    thr = pred_dir_fund_liq_threshold() if liq_threshold is None else float(liq_threshold)
    dir_liq_risk = 0
    dir_beta_risk = 0

    liq_ok = True
    if liquidity_score is not None:
        try:
            liq = float(liquidity_score)
            liq_ok = math.isfinite(liq) and liq >= thr
        except (TypeError, ValueError):
            liq_ok = True

    if not liq_ok and (
        net_score >= _NET_MILD or _is_bullish_strong_label(direction_label)
    ):
        conf *= 0.85
        dir_liq_risk = 1

    beta_high = False
    if beta is not None:
        try:
            b = float(beta)
            beta_high = math.isfinite(b) and b > 1.8
        except (TypeError, ValueError):
            beta_high = False

    if beta_high and abs(int(net_score)) >= _NET_MILD:
        conf *= 0.90
        dir_beta_risk = 1

    return round(max(0.05, min(1.0, conf)), 3), dir_liq_risk, dir_beta_risk


def _label_from_net(
    net: int,
    ph_num: int | None,
    *,
    beta: float | None = None,
    days_to_t: float | None = None,
) -> str:
    mild, strong = _NET_MILD, _NET_STRONG
    if ph_num == 2:
        mild, strong = _PH2_NET_MILD, _PH2_NET_STRONG
    if beta is not None:
        try:
            b = float(beta)
            if b > 1.8:
                mild += 1
                strong += 1
        except (TypeError, ValueError):
            pass
    # Soglie adattive per distanza dall'evento: evita call direzionali false a T lontano.
    # Hit% storico: T<=15gg ~65%, T>15gg ~49% (vicino al caso). Si alza mild di conseguenza.
    if days_to_t is not None:
        try:
            d = float(days_to_t)
            if d > _DAYS_FAR_THRESHOLD:
                # T>30gg: richiede net>=5 — quasi solo Stabile
                delta = max(0, (_NET_MILD + 2) - mild)
                mild += delta
                strong += delta
            elif d > _DAYS_MID_THRESHOLD:
                # T>15gg: richiede net>=4 — call direzionale solo con consenso forte
                delta = max(0, (_NET_MILD + 1) - mild)
                mild += delta
                strong += delta
        except (TypeError, ValueError):
            pass
    if net >= strong:
        return "↑↑ Forte crescita"
    if net >= mild:
        return "↑ Crescita lieve"
    if net <= -strong:
        return "↓↓ Calo forte"
    if net <= -mild:
        return "↓ Calo lieve"
    return "→ Stabile"


def _pick_reason_notes(
    net: int,
    bull_r: list[str],
    bear_r: list[str],
) -> list[str]:
    if net >= _NET_MILD:
        return bull_r[:4]
    if net <= -_NET_MILD:
        return bear_r[:4]
    return []


def _confidence_from_scores(
    net: int,
    bull: int,
    bear: int,
    *,
    ph_num: int | None,
    has_options: bool,
    mixed_signals: bool,
    calib_mult: float,
    price_ok: bool = True,
    data_quality_score: float | None = None,
) -> float:
    """Confidence 0–1 da |net| vs soglia fase, penalità dati mancanti / conflitto."""
    mild = _PH2_NET_MILD if ph_num == 2 else _NET_MILD
    strong = _PH2_NET_STRONG if ph_num == 2 else _NET_STRONG
    scale = float(strong) if abs(net) >= strong else float(mild)
    base = min(1.0, abs(net) / scale) if scale > 0 else 0.0
    # Curva morbida oltre la soglia lineare (evita salti netti a net=strong±1)
    base = 0.5 * base + 0.5 * (1.0 / (1.0 + math.exp(-0.9 * (abs(net) - mild))))
    if mixed_signals:
        base *= 0.72
    if not has_options:
        base *= 0.88
    if not price_ok:
        base *= 0.35
    if data_quality_score is not None:
        base *= max(0.25, min(1.0, float(data_quality_score)))
    if ph_num == 2:
        base *= 0.92
    return round(max(0.05, min(1.0, base * calib_mult)), 3)


def _apply_fundamental_direction_penalties(
    result: DirectionResult,
    *,
    liquidity_score: float | None,
    beta: float | None,
) -> DirectionResult:
    """Confidence penalties only — label sign unchanged."""
    if not pred_dir_fund_penalty_enabled():
        return result

    conf = result.confidence
    net = result.net_score
    dir_liq_risk = 0
    dir_beta_risk = 0

    if liquidity_score is not None:
        try:
            liq = float(liquidity_score)
            if liq < 0.65 and net >= _NET_MILD:
                conf *= 0.85
                dir_liq_risk = 1
                result.notes.append(f"dir liq risk (score {liq:.2f})")
        except (TypeError, ValueError):
            pass

    if beta is not None:
        try:
            b = float(beta)
            if b > 1.8 and abs(net) >= _NET_MILD:
                conf *= 0.90
                dir_beta_risk = 1
                result.notes.append(f"dir beta risk (β {b:.2f})")
        except (TypeError, ValueError):
            pass

    result.confidence = round(max(0.05, min(1.0, conf)), 3)
    result.dir_liquidity_risk = dir_liq_risk
    result.dir_beta_risk = dir_beta_risk
    return result


def _accumulate_scores(
    ph_num,
    exc_slope,
    slope,
    rsi_val,
    vol_ratio,
    vol_accel,
    run_up,
    slope_5d,
    slope_20d,
    run_up_7d,
    ath_prox,
    vol_px_div,
    pcr,
    exp_move_pct,
    days_to_t,
) -> tuple[int, int, list[str], list[str], list[str]]:
    """Calcola bull/bear e motivazioni (senza label finale)."""
    notes: list[str] = []
    bull = 0
    bear = 0
    bull_r: list[str] = []
    bear_r: list[str] = []

    if ph_num == 2:
        # Non più return anticipato: Fase 2 usa pesi ridotti e soglie più alte sotto.
        notes.append("Ph2: soglia direzionale ↑ (~70% fail storico)")

    # ── Prior bayesiano: Probabilità di Successo per fase clinica ─────────────
    # Fonte: BIO/Informa 2011-2020 + calibrazione empirica interna.
    # Ph1=63%, Ph2=41%, Ph3=65%, Ph4=78% → contributo proporzionale alla distanza da 50%.
    _pos_score, _pos_val = phase_pos_score(ph_num)
    _pos_note = phase_pos_label(ph_num)
    if _pos_note:
        notes.append(_pos_note)   # sempre visibile nei meta_notes
    if _pos_score > 0:
        bull += _pos_score
        bull_r.append(_pos_note)
    elif _pos_score < 0:
        bear += abs(_pos_score)
        bear_r.append(_pos_note)

    _s = exc_slope if exc_slope is not None else slope
    if _s is not None:
        if _s >= 1.5:
            bull += 2
            bull_r.append(f"slope+{_s:+.2f}")
        elif _s >= 0.5:
            bull += 1
            bull_r.append(f"slope+{_s:+.2f}")
        elif _s <= -1.5:
            bear += 2
            bear_r.append(f"slope{_s:+.2f}")
        elif _s <= -0.5:
            bear += 1
            bear_r.append(f"slope{_s:+.2f}")

    if rsi_val is not None:
        if rsi_val > 72:
            bear += 2
            bear_r.append(f"RSI OB {rsi_val:.0f}")
        elif rsi_val > 65:
            bear += 1
            bear_r.append(f"RSI alto {rsi_val:.0f}")
        elif rsi_val < 28:
            bull += 2
            bull_r.append(f"RSI OS {rsi_val:.0f}")
        elif rsi_val < 35:
            bull += 1
            bull_r.append(f"RSI basso {rsi_val:.0f}")

    _vbull = 0
    _vbear = 0
    if vol_ratio is not None:
        if vol_ratio >= 2.0:
            _vbull += 2
            bull_r.append(f"vol {vol_ratio:.1f}x")
        elif vol_ratio >= 1.5:
            _vbull += 1
            bull_r.append(f"vol {vol_ratio:.1f}x")
        elif vol_ratio < 0.6:
            _vbear += 1
            bear_r.append(f"vol↓ {vol_ratio:.1f}x")
    if vol_accel is not None:
        if vol_accel >= 2.0:
            _vbull += 2
            bull_r.append(f"va {vol_accel:.1f}x")
        elif vol_accel >= 1.5:
            _vbull += 1
            bull_r.append(f"va {vol_accel:.1f}x")
        elif vol_accel < 0.6:
            _vbear += 1
            bear_r.append(f"va↓ {vol_accel:.1f}x")
    bull += min(_vbull, 2)
    bear += min(_vbear, 2)

    if (
        slope_5d is not None
        and slope_20d is not None
        and abs(slope_5d) > 0.3
        and abs(slope_20d) > 0.3
    ):
        if slope_5d > 0 and slope_20d > 0:
            bull += 1
            bull_r.append("TF↑↑")
        elif slope_5d < 0 and slope_20d < 0:
            bear += 1
            bear_r.append("TF↓↓")

    # slope5d come segnale indipendente di momentum a breve termine.
    # Il dual-TF sopra pesa +1 solo quando slope20d è allineato; questo blocco
    # cattura accelerazioni recenti forti anche con slope20d piatto o opposto.
    # Soglie base: ±1.5 pp/g moderato (1 pt), ±2.5 pp/g forte (2 pt).
    # Il peso (default 1.0) viene scalato dalla calibrazione storica contrarian:
    #   weight > 1 → slope5d storicamente più affidabile del modello in setup contrarian
    #   weight < 1 → modello più affidabile → ridurre contributo slope5d
    if slope_5d is not None:
        try:
            s5 = float(slope_5d)
            _w = _load_s5d_weight()
            _pts_strong = max(1, min(3, round(2 * _w)))
            _pts_mild   = max(1, min(2, round(1 * _w)))
            _w_tag = f"×{_w:.2f}" if abs(_w - 1.0) > 0.04 else ""
            if s5 >= 2.5:
                bull += _pts_strong
                bull_r.append(f"s5d↑↑ {s5:+.1f}{_w_tag}")
            elif s5 >= 1.5:
                bull += _pts_mild
                bull_r.append(f"s5d↑ {s5:+.1f}{_w_tag}")
            elif s5 <= -2.5:
                bear += _pts_strong
                bear_r.append(f"s5d↓↓ {s5:+.1f}{_w_tag}")
            elif s5 <= -1.5:
                bear += _pts_mild
                bear_r.append(f"s5d↓ {s5:+.1f}{_w_tag}")
        except (TypeError, ValueError):
            pass

    if run_up is not None:
        _ph3 = ph_num == 3
        if run_up > 20:
            w = 3 if _ph3 else 2
            bear += w
            bear_r.append(f"BTR+{run_up:.0f}%")
        elif run_up > 15:
            bear += 2
            bear_r.append(f"BTR+{run_up:.0f}%")
        elif run_up > 8:
            bear += 1
            bear_r.append(f"run+{run_up:.0f}%")
        elif run_up < -20:
            w = 3 if _ph3 else 2
            bull += w
            bull_r.append(f"CTR{run_up:.0f}%")
        elif run_up < -15:
            bull += 2
            bull_r.append(f"CTR{run_up:.0f}%")
        elif run_up < -8:
            bull += 1
            bull_r.append(f"dip{run_up:.0f}%")

    if run_up is not None and run_up_7d is not None and abs(run_up) >= 8:
        if run_up > 0:
            r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
            if r7 < 0.35:
                bull += 1
                bull_r.append(f"drift graduale {run_up:.0f}%")
            elif r7 > 0.70:
                bear += 1
                bear_r.append(f"spike7gg {run_up_7d:.0f}%")
        elif run_up < 0:
            r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
            if r7 < 0.35:
                bear += 1
                bear_r.append(f"sell graduale {run_up:.0f}%")
            elif r7 > 0.70:
                bull += 1
                bull_r.append(f"panic7gg {run_up_7d:.0f}%")

    if ath_prox is not None:
        if ath_prox >= 0.92:
            bear += 1
            bear_r.append(f"vicino ATH {ath_prox:.0%}")
        elif ath_prox <= 0.45:
            bull += 1
            bull_r.append(f"lontano ATH {ath_prox:.0%}")

    if vol_px_div == +1:
        bull += 1
        bull_r.append("div vol↑px↓ (accum.)")
    elif vol_px_div == -1:
        bear += 1
        bear_r.append("div vol↓px↑ (distrib.)")

    if pcr is not None:
        if pcr > 2.5:
            bull += 2
            bull_r.append(f"PCR panico {pcr:.1f}")
        elif pcr > 1.5:
            bull += 1
            bull_r.append(f"PCR hedge {pcr:.1f}")
        elif pcr < 0.50:
            bear += 2
            bear_r.append(f"PCR call-frenzy {pcr:.2f}")
        elif pcr < 0.70:
            bear += 1
            bear_r.append(f"PCR call-excess {pcr:.2f}")

    if exp_move_pct is not None and exp_move_pct > 25 and pcr is not None:
        if pcr < 0.65:
            bull += 1
            bull_r.append(f"bigmove+call {exp_move_pct:.0f}%")
        elif pcr > 1.50:
            bear += 1
            bear_r.append(f"bigmove+put {exp_move_pct:.0f}%")

    if (
        days_to_t is not None
        and run_up is not None
        and slope is not None
        and days_to_t <= 30
        and run_up > 5
        and slope > 0
    ):
        if days_to_t <= 7:
            bear += 2
            bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")
        elif days_to_t <= 14:
            bear += 1
            bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")
        else:
            bear += 1
            bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")

    return bull, bear, bull_r, bear_r, notes


def direction_ensemble_detail(
    ph_num,
    exc_slope,
    slope,
    rsi_val,
    vol_ratio,
    vol_accel,
    run_up,
    slope_5d,
    slope_20d,
    run_up_7d=None,
    ath_prox=None,
    vol_px_div=0,
    pcr=None,
    exp_move_pct=None,
    days_to_t=None,
    *,
    calibration_records: list | None = None,
    price_ok: bool = True,
    data_quality_score: float | None = None,
    liquidity_score: float | None = None,
    beta: float | None = None,
) -> DirectionResult:
    """Calcolo completo con confidence e punteggi esposti."""
    bull, bear, bull_r, bear_r, notes = _accumulate_scores(
        ph_num,
        exc_slope,
        slope,
        rsi_val,
        vol_ratio,
        vol_accel,
        run_up,
        slope_5d,
        slope_20d,
        run_up_7d,
        ath_prox,
        vol_px_div,
        pcr,
        exp_move_pct,
        days_to_t,
    )

    if ph_num == 2:
        bull = max(0, int(round(bull * _PH2_SCORE_FACTOR)))
        bear = max(0, int(round(bear * _PH2_SCORE_FACTOR)))

    net = bull - bear
    pred = _label_from_net(net, ph_num, beta=beta, days_to_t=days_to_t)
    meta_notes = list(notes)

    # Nota di soppressione: se la soglia temporale ha bloccato una call direzionale
    # (|net| avrebbe superato _NET_MILD senza il filtro tempo)
    if days_to_t is not None and pred == "→ Stabile":
        try:
            _d = float(days_to_t)
            _base_mild = _PH2_NET_MILD if ph_num == 2 else _NET_MILD
            if _d > _DAYS_FAR_THRESHOLD and abs(net) >= _base_mild:
                meta_notes.append(
                    f"T-{_d:.0f}gg: call soppresso (net={net:+d} < soglia {_base_mild + 2})"
                )
            elif _d > _DAYS_MID_THRESHOLD and abs(net) >= _base_mild:
                meta_notes.append(
                    f"T-{_d:.0f}gg: call sospeso (net={net:+d} < soglia {_base_mild + 1})"
                )
        except (TypeError, ValueError):
            pass

    reason = _pick_reason_notes(net, bull_r, bear_r)
    if reason:
        notes = meta_notes + reason
    elif pred == "→ Stabile":
        notes = [f"neutro (B{bull}/S{bear})"] + meta_notes
    else:
        notes = meta_notes

    has_options = pcr is not None or exp_move_pct is not None
    mixed = bull >= 2 and bear >= 2 and abs(net) < (_PH2_NET_MILD if ph_num == 2 else _NET_MILD)
    if mixed:
        notes.append("segnali misti B/S")
    if not has_options:
        notes.append("no options (PCR/move)")
    if not price_ok:
        notes.append("DQ: prezzo assente (conf ridotta)")

    calib_mult = direction_calib_multiplier(calibration_records)
    conf = _confidence_from_scores(
        net,
        bull,
        bear,
        ph_num=ph_num,
        has_options=has_options,
        mixed_signals=mixed,
        calib_mult=calib_mult,
        price_ok=price_ok,
        data_quality_score=data_quality_score,
    )

    notes.append(f"[B{bull} S{bear} net{net:+d} conf{conf:.2f}]")

    # Rotation veto + optional UP confidence gate (pre-catalyst signal hygiene)
    try:
        from prediction.signal_filters import apply_rotation_veto, apply_up_confidence_gate

        vetoed = apply_rotation_veto(pred, slope_5d, slope_20d)
        if vetoed != pred:
            notes.append("rotation_veto: UP soppresso (slope5/20 in rotazione)")
            pred = vetoed
        if pred.startswith("↑"):
            gated = apply_up_confidence_gate(
                pred,
                slope_5d=slope_5d,
                slope_20d=slope_20d,
                vol_ratio=vol_ratio,
                rsi_14=rsi_val,
                days_to_cd=int(days_to_t) if days_to_t is not None else None,
            )
            if gated != pred:
                notes.append("up_confidence_gate: UP -> NEUTRAL")
                pred = gated
    except Exception:
        pass

    result = DirectionResult(
        direction_label=pred,
        notes=notes,
        confidence=conf,
        bull_score=bull,
        bear_score=bear,
        net_score=net,
        phase=ph_num,
    )
    return _apply_fundamental_direction_penalties(
        result, liquidity_score=liquidity_score, beta=beta
    )


@overload
def direction_ensemble(
    ph_num,
    exc_slope,
    slope,
    rsi_val,
    vol_ratio,
    vol_accel,
    run_up,
    slope_5d,
    slope_20d,
    run_up_7d=None,
    ath_prox=None,
    vol_px_div=0,
    pcr=None,
    exp_move_pct=None,
    days_to_t=None,
    *,
    return_detail: bool = False,
    calibration_records: list | None = None,
) -> tuple[str, list[str]]: ...


@overload
def direction_ensemble(
    ph_num,
    exc_slope,
    slope,
    rsi_val,
    vol_ratio,
    vol_accel,
    run_up,
    slope_5d,
    slope_20d,
    run_up_7d=None,
    ath_prox=None,
    vol_px_div=0,
    pcr=None,
    exp_move_pct=None,
    days_to_t=None,
    *,
    return_detail: bool,
    calibration_records: list | None = None,
) -> DirectionResult | tuple[str, list[str]]: ...


def direction_ensemble(
    ph_num,
    exc_slope,
    slope,
    rsi_val,
    vol_ratio,
    vol_accel,
    run_up,
    slope_5d,
    slope_20d,
    run_up_7d=None,
    ath_prox=None,
    vol_px_div=0,
    pcr=None,
    exp_move_pct=None,
    days_to_t=None,
    *,
    return_detail: bool = False,
    calibration_records: list | None = None,
    price_ok: bool = True,
    data_quality_score: float | None = None,
    liquidity_score: float | None = None,
    beta: float | None = None,
) -> DirectionResult | tuple[str, list[str]]:
    """
    Ensemble v4.1 — predice la direzione post-catalyst.

    Default (``return_detail=False``): ``(label, notes)`` come v4 per retrocompatibilità.
    Con ``return_detail=True``: ``DirectionResult`` con confidence e punteggi.
    """
    result = direction_ensemble_detail(
        ph_num,
        exc_slope,
        slope,
        rsi_val,
        vol_ratio,
        vol_accel,
        run_up,
        slope_5d,
        slope_20d,
        run_up_7d=run_up_7d,
        ath_prox=ath_prox,
        vol_px_div=vol_px_div,
        pcr=pcr,
        exp_move_pct=exp_move_pct,
        days_to_t=days_to_t,
        calibration_records=calibration_records,
        price_ok=price_ok,
        data_quality_score=data_quality_score,
        liquidity_score=liquidity_score,
        beta=beta,
    )
    if return_detail:
        return result
    return result.direction_label, result.notes
