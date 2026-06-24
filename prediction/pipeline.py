"""
Prediction pipeline entry point (Phase A: delegates to orchestrator).

``PRED_ENGINE=v5`` routes curve fan charts to the v5 MRM+PCG prototype; direction
and legacy calibration still use the orchestrator path until full v5 integration.

Accuracy Excel columns «Pred v5 q50 …» are filled from v5 (independent of
``PRED_ENGINE``) via ``predict_v5_q50_offsets`` inside ``_compute_price_predictions``.
"""
from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from prediction.config import (
    pred_engine,
    pred_v5_align_sign_v4_enabled,
    pred_v5_anchor_q50_v4_enabled,
    pred_v5_calib_enabled,
    pred_v5_cohort_prior_enabled,
    pred_v5_excel_fan_enabled,
    pred_v5_sim_display_mode,
)
from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution
from prediction.types import PredictionConfig

# Calendar offsets on Accuracy «Pred v5 q50» (allineati a v4, incl. T-5).
SIMULATION_V5_Q50_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)

# v4 horizon %% keys nearest each v5 display offset (sign align + q50 anchor).
_V4_PCT_KEY_BY_V5_OFFSET: dict[int, str] = {
    -60: "model_dm60_pct",
    -30: "model_dm30_pct",
    -10: "model_dm10_pct",
    -7: "model_dm7_pct",
    -5: "model_dm5_pct",
    -3: "model_dm3_pct",
    4: "model_d4_pct",
    7: "model_d7_pct",
}

_V5_SIGN_ALIGN_MIN_PP = 0.5


def simulation_v5_header_for_offset(off: int, *, quantile: str = "q50") -> str:
    """Italian header (row 3) for a v5 fan column at calendar offset ``off``."""
    if off > 0:
        suffix = f"+{off}"
    else:
        suffix = str(off)
    q = str(quantile or "q50").strip().lower()
    return f"Pred v5\n{q}\n{suffix}"


def accuracy_v5_excel_column_count() -> int:
    """Colonne v5 sul foglio Accuracy (sempre 8 × q50)."""
    return len(SIMULATION_V5_Q50_OFFSETS)


def accuracy_v5_headers() -> tuple[str, ...]:
    """Intestazioni colonne v5 sul foglio Accuracy (solo mediana q50)."""
    return tuple(simulation_v5_header_for_offset(o) for o in SIMULATION_V5_Q50_OFFSETS)


def v5_q50_from_fan(fan: Mapping[str, Any] | None) -> dict[str, float | None]:
    """Estrae ``{str(off): q50}`` da ``v5_fan_offsets``."""
    out: dict[str, float | None] = {str(o): None for o in SIMULATION_V5_Q50_OFFSETS}
    if not isinstance(fan, dict):
        return out
    for off in SIMULATION_V5_Q50_OFFSETS:
        sk = str(off)
        node = fan.get(sk)
        if isinstance(node, dict):
            out[sk] = node.get("q50")
        elif node is not None:
            try:
                out[sk] = round(float(node), 2)
            except (TypeError, ValueError):
                pass
    return out


def sync_v5_fan_to_accuracy_display_pred(
    fan: Mapping[str, Mapping[str, float | None]] | None,
    display_pred_pts: Sequence[float | None],
    *,
    offsets: tuple[int, ...] = SIMULATION_V5_Q50_OFFSETS,
) -> dict[str, dict[str, float | None]]:
    """Allinea q50 nel fan alla colonna Pred % mostrata (come ``sync_v5_q50_to_accuracy_display_pred``)."""
    from prediction.accuracy_v4_v5 import ACCURACY_V4_DISPLAY_OFFSETS

    if not isinstance(fan, dict):
        fan = {}
    out: dict[str, dict[str, float | None]] = {}
    for off in offsets:
        sk = str(off)
        node = dict(fan.get(sk) or {})
        if not node and fan.get(off) is not None:
            node = {"q50": fan.get(off)}
        out[sk] = {
            "q05": node.get("q05"),
            "q50": node.get("q50"),
            "q95": node.get("q95"),
        }
    if not pred_v5_anchor_q50_v4_enabled():
        return out
    q50_map = sync_v5_q50_to_accuracy_display_pred(
        v5_q50_from_fan(out), display_pred_pts, offsets=offsets
    )
    for i, off in enumerate(ACCURACY_V4_DISPLAY_OFFSETS):
        if off not in offsets:
            continue
        sk = str(off)
        v = q50_map.get(sk)
        if v is None:
            continue
        node = out.get(sk) or {"q05": None, "q50": None, "q95": None}
        try:
            vf = float(v)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(vf):
            continue
        q50_old = node.get("q50")
        try:
            q50f = float(q50_old) if q50_old is not None else vf
        except (TypeError, ValueError):
            q50f = vf
        lo = q50f - float(node.get("q05") or q50f)
        hi = float(node.get("q95") or q50f) - q50f
        out[sk] = {
            "q05": round(vf - lo, 2),
            "q50": round(vf, 2),
            "q95": round(vf + hi, 2),
        }
    return out


def apply_v5_sim_display_to_pred_points(
    v4_pts: Sequence[float | None],
    pred_row: Mapping[str, Any] | None,
    *,
    offsets: tuple[int, ...] = SIMULATION_V5_Q50_OFFSETS,
) -> list[float | None]:
    """
    ``PRED_V5_SIM_DISPLAY``: v4 (default), v5 (q50 fan) o blend 50/50 con v4.
    """
    mode = pred_v5_sim_display_mode()
    if mode == "v4" or not isinstance(pred_row, dict):
        return list(v4_pts)
    fan = pred_row.get("v5_fan_offsets")
    q50 = v5_q50_from_fan(fan if isinstance(fan, dict) else None)
    if not any(q50.get(str(o)) is not None for o in offsets):
        q50 = pred_row.get("v5_q50_offsets") if isinstance(pred_row.get("v5_q50_offsets"), dict) else q50
    out: list[float | None] = []
    for i, off in enumerate(offsets):
        v4v = v4_pts[i] if i < len(v4_pts) else None
        v5v = q50.get(str(off))
        if mode == "v5":
            out.append(v5v if v5v is not None else v4v)
            continue
        if v4v is None:
            out.append(v5v)
        elif v5v is None:
            out.append(v4v)
        else:
            try:
                out.append(round((float(v4v) + float(v5v)) / 2.0, 2))
            except (TypeError, ValueError):
                out.append(v4v)
    return out


def _resolve_vol_20d(
    row: dict,
    prices: Sequence[float] | None,
) -> float | None:
    """Realized 20d log-return vol — never the volume build-up ``vol_ratio`` proxy."""
    v = row.get("vol_20d")
    if v is not None:
        try:
            x = float(v)
            if x == x and x >= 0:
                return x
        except (TypeError, ValueError):
            pass
    if prices is not None and len(prices) >= 5:
        from prediction.v5.mrm import drift_sigma_from_prices

        xbi = row.get("exc_slope_vs_XBI")
        if xbi is None:
            xbi = row.get("exc_slope")
        regime = drift_sigma_from_prices(prices, xbi_slope=xbi)
        return float(regime.metadata.get("vol_20d", 0.02))
        return None


def _direction_label_sign(label: str | None) -> int:
    d = str(label or "")
    if d.startswith("↑"):
        return 1
    if d.startswith("↓"):
        return -1
    return 0


def _numeric_sign(v: float | None) -> int:
    if v is None:
        return 0
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(x) or abs(x) < 1e-9:
        return 0
    return 1 if x > 0 else -1


def v4_implied_sign_at_offset(row: Mapping[str, Any], offset: int) -> int:
    """
    Segno v4 per un nodo calendario: prima ``model_dm*`` / ``model_d*`` sul nodo,
    poi ``dir_v4`` / ``direction``.
    """
    key = _V4_PCT_KEY_BY_V5_OFFSET.get(offset)
    if key:
        raw = row.get(key)
        if raw is not None:
            try:
                pct = float(raw)
                if math.isfinite(pct):
                    s = _numeric_sign(pct)
                    if s != 0:
                        return s
            except (TypeError, ValueError):
                pass
    for dk in ("dir_v4", "direction"):
        s = _direction_label_sign(row.get(dk))
        if s != 0:
            return s
    return 0


def sync_v5_q50_to_accuracy_display_pred(
    v5_offsets: dict[str, float | None],
    display_pred_pts: Sequence[float | None],
    *,
    offsets: tuple[int, ...] = SIMULATION_V5_Q50_OFFSETS,
) -> dict[str, float | None]:
    """
    Per Accuratezza / MAE temporale: con ``PRED_V5_ANCHOR_Q50_V4`` il q50 v5 deve
    coincidere con la colonna Pred % mostrata (``display_pred_pts``), non solo con
    i nodi grezzi ``model_dm*`` (che differiscono da seq+blend / interpolazione).
    """
    from prediction.accuracy_v4_v5 import ACCURACY_V4_DISPLAY_OFFSETS

    out = dict(v5_offsets or {})
    if not pred_v5_anchor_q50_v4_enabled():
        return out
    for i, off in enumerate(ACCURACY_V4_DISPLAY_OFFSETS):
        if off not in offsets:
            continue
        if i >= len(display_pred_pts):
            continue
        v = display_pred_pts[i]
        if v is None:
            continue
        try:
            vf = float(v)
            if math.isfinite(vf):
                out[str(off)] = round(vf, 2)
        except (TypeError, ValueError):
            continue
    return out


def v4_pct_at_v5_offsets(row: Mapping[str, Any]) -> dict[int, float | None]:
    """Valori v4 (% vs T-60) sui nodi v5 (chiavi ``model_dm*`` / ``model_d*``)."""
    out: dict[int, float | None] = {}
    for off in SIMULATION_V5_Q50_OFFSETS:
        key = _V4_PCT_KEY_BY_V5_OFFSET.get(off)
        if not key:
            out[off] = None
            continue
        raw = row.get(key)
        if raw is None:
            out[off] = None
            continue
        try:
            x = float(raw)
            out[off] = round(x, 2) if math.isfinite(x) else None
        except (TypeError, ValueError):
            out[off] = None
    return out


def anchor_v5_distribution_q50_to_v4(
    dist: PredictionDistribution,
    v4_by_offset: Mapping[int, float | None],
) -> bool:
    """
    Sposta q50 sul valore v4; mantiene la semi-larghezza MC su q05/q95 (banda intorno a v4).
    """
    anchored = False
    nodes = dict(dist.nodes)
    for off, node in list(nodes.items()):
        v4v = v4_by_offset.get(off)
        if v4v is None:
            continue
        try:
            v4f = float(v4v)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(v4f):
            continue
        lo = float(node.q50) - float(node.q05)
        hi = float(node.q95) - float(node.q50)
        nodes[off] = CurveNodeQuantiles(
            offset=off,
            q05=round(v4f - lo, 4),
            q50=round(v4f, 4),
            q95=round(v4f + hi, 4),
        )
        anchored = True
    dist.nodes = nodes
    return anchored


def align_v5_q50_signs_to_v4(
    q50_by_offset: dict[str, float | None],
    row: Mapping[str, Any],
    *,
    min_abs_pp: float = _V5_SIGN_ALIGN_MIN_PP,
) -> bool:
    """
    Se ``|q50| > min_abs_pp`` e il segno differisce da v4, applica ``sign(v4)*|q50|``.

    Returns True se almeno un nodo è stato riallineato.
    """
    aligned = False
    for off in SIMULATION_V5_Q50_OFFSETS:
        sk = str(off)
        q = q50_by_offset.get(sk)
        if q is None:
            continue
        try:
            qf = float(q)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(qf) or abs(qf) <= min_abs_pp:
            continue
        v4s = v4_implied_sign_at_offset(row, off)
        qsign = _numeric_sign(qf)
        if v4s == 0 or qsign == 0 or v4s == qsign:
            continue
        q50_by_offset[sk] = round(v4s * abs(qf), 2)
        aligned = True
    return aligned


def predict_v5_fan_offsets(
    row: dict,
    *,
    prices: Sequence[float] | None = None,
    n_paths: int = 2000,
    seed: int | None = None,
    past_pred_rows: Mapping[str, Mapping[str, Any]] | None = None,
    cohort_mu_by_offset: dict[int, float] | None = None,
    apply_calibration: bool | None = None,
    anchor_q50_v4: bool | None = None,
) -> dict[str, dict[str, float | None]]:
    """
    Return ``{str(offset): {q05, q50, q95}}`` for ``SIMULATION_V5_Q50_OFFSETS``.

    Popola anche ``row["v5_q50_offsets"]`` e metadati anchor/align.
    """
    from prediction.v5 import predict_v5_curve

    empty_node = {"q05": None, "q50": None, "q95": None}
    empty = {str(off): dict(empty_node) for off in SIMULATION_V5_Q50_OFFSETS}

    price_seq = prices
    if price_seq is None:
        ps = row.get("price_series")
        if isinstance(ps, (list, tuple)):
            price_seq = ps

    vol_20d = _resolve_vol_20d(row, price_seq)
    xbi = row.get("exc_slope_vs_XBI")
    if xbi is None:
        xbi = row.get("exc_slope")

    cd_anchor = row.get("expected_move_pct")
    if cd_anchor is None:
        cd_anchor = row.get("model_d5_pct")

    beta = row.get("beta")
    liq = row.get("liquidity_score")
    try:
        _b = float(beta) if beta is not None else None
        if _b is not None and _b != _b:
            _b = None
    except (TypeError, ValueError):
        _b = None
    try:
        _liq = float(liq) if liq is not None else None
        if _liq is not None and _liq != _liq:
            _liq = None
    except (TypeError, ValueError):
        _liq = None

    _cohort_mu = cohort_mu_by_offset
    if _cohort_mu is None and pred_v5_cohort_prior_enabled():
        from prediction.v5.cohort_prior import build_nct_cohort_mu

        _src = past_pred_rows
        if _src is None:
            from prediction.v5.cohort_prior import load_past_pred_rows_from_disk

            _src = load_past_pred_rows_from_disk()
        _cohort_mu = build_nct_cohort_mu(_src)

    try:
        dist = predict_v5_curve(
            prices=price_seq if price_seq is not None else None,
            slope_20d=row.get("slope_20d"),
            vol_20d=vol_20d,
            run_up_30d=row.get("run_up_30d"),
            xbi_slope=xbi,
            beta=_b,
            liquidity_score=_liq,
            cd_anchor_pct=cd_anchor,
            cohort_mu_by_offset=_cohort_mu,
            n_paths=n_paths,
            seed=seed,
        )
    except Exception:
        row["v5_fan_offsets"] = empty
        row["v5_q50_offsets"] = {k: None for k in empty}
        return empty

    if _cohort_mu:
        dist.metadata = dict(dist.metadata or {})
        dist.metadata["cohort_mu_nct"] = True
        dist.metadata["cohort_mu_offsets"] = len(_cohort_mu)

    _do_calib = pred_v5_calib_enabled() if apply_calibration is None else bool(apply_calibration)
    if _do_calib:
        from prediction.v5.calibration import apply_v5_calibration_to_distribution, load_v5_calibration

        _cal = load_v5_calibration()
        if _cal:
            row["v5_calib_applied"] = apply_v5_calibration_to_distribution(dist, _cal)
        else:
            row["v5_calib_applied"] = False
    else:
        row["v5_calib_applied"] = False

    v4_by_off = v4_pct_at_v5_offsets(row)
    _do_anchor = (
        pred_v5_anchor_q50_v4_enabled()
        if anchor_q50_v4 is None
        else bool(anchor_q50_v4)
    )
    if _do_anchor and any(v is not None for v in v4_by_off.values()):
        row["v5_q50_anchored_v4"] = anchor_v5_distribution_q50_to_v4(dist, v4_by_off)
    else:
        row["v5_q50_anchored_v4"] = False

    fan: dict[str, dict[str, float | None]] = {}
    for off in SIMULATION_V5_Q50_OFFSETS:
        node = dist.nodes.get(off)
        if node is None:
            fan[str(off)] = dict(empty_node)
        else:
            fan[str(off)] = {
                "q05": round(float(node.q05), 2),
                "q50": round(float(node.q50), 2),
                "q95": round(float(node.q95), 2),
            }

    q50_flat = v5_q50_from_fan(fan)
    if pred_v5_align_sign_v4_enabled() and not row.get("v5_q50_anchored_v4"):
        row["v5_sign_aligned"] = bool(align_v5_q50_signs_to_v4(q50_flat, row))
        for off in SIMULATION_V5_Q50_OFFSETS:
            sk = str(off)
            if q50_flat.get(sk) is not None and fan.get(sk):
                fan[sk]["q50"] = q50_flat[sk]
    else:
        row["v5_sign_aligned"] = False

    row["v5_fan_offsets"] = fan
    row["v5_q50_offsets"] = q50_flat
    return fan


def predict_v5_q50_offsets(
    row: dict,
    *,
    prices: Sequence[float] | None = None,
    n_paths: int = 2000,
    seed: int | None = None,
    past_pred_rows: Mapping[str, Mapping[str, Any]] | None = None,
    cohort_mu_by_offset: dict[int, float] | None = None,
    apply_calibration: bool | None = None,
) -> dict[str, float | None]:
    """Return ``{str(offset): q50_pct}`` (wrapper su ``predict_v5_fan_offsets``)."""
    predict_v5_fan_offsets(
        row,
        prices=prices,
        n_paths=n_paths,
        seed=seed,
        past_pred_rows=past_pred_rows,
        cohort_mu_by_offset=cohort_mu_by_offset,
        apply_calibration=apply_calibration,
    )
    stored = row.get("v5_q50_offsets")
    if isinstance(stored, dict):
        return dict(stored)
    return {str(off): None for off in SIMULATION_V5_Q50_OFFSETS}


def predict_catalyst(
    sim_rows: list,
    *,
    config: PredictionConfig | None = None,
) -> dict:
    """
    Run catalyst price predictions for the given simulation rows.

    Phase A: thin delegate to ``data_orchestrator._compute_price_predictions``.
    """
    cfg = config or PredictionConfig()
    import data_orchestrator as orch

    return orch._compute_price_predictions(
        sim_rows,
        calibration_state=cfg.calibration_state,
        financial_df=cfg.financial_df,
    )


def predict_v5_curve_for_row(
    row: dict,
    *,
    n_paths: int = 2000,
    seed: int | None = None,
) -> dict:
    """
    v5 hook for a single simulation / catalyst row (prototype).

    Uses technical fields on ``row`` when present; optional ``price_series`` list.
    Returns ``PredictionDistribution.as_dict()`` plus ``engine: v5``.
    """
    from prediction.v5 import predict_v5_curve

    prices = row.get("price_series")
    price_seq = prices if isinstance(prices, (list, tuple)) else None
    vol_20d = _resolve_vol_20d(row, price_seq)
    xbi = row.get("exc_slope_vs_XBI")
    if xbi is None:
        xbi = row.get("exc_slope")

    dist = predict_v5_curve(
        prices=price_seq,
        slope_20d=row.get("slope_20d"),
        vol_20d=vol_20d,
        run_up_30d=row.get("run_up_30d"),
        xbi_slope=xbi,
        cd_anchor_pct=row.get("expected_move_pct") or row.get("model_d5_pct"),
        n_paths=n_paths,
        seed=seed,
    )
    out = dist.as_dict()
    out["engine"] = "v5"
    out["v5_fan_offsets"] = predict_v5_fan_offsets(
        row, prices=price_seq, n_paths=n_paths, seed=seed
    )
    out["v5_q50_offsets"] = dict(row.get("v5_q50_offsets") or v5_q50_from_fan(out["v5_fan_offsets"]))
    if row.get("v5_sign_aligned"):
        out["v5_sign_aligned"] = True
    return out


def forecast_precat_curve_for_row(row: dict) -> dict | None:
    """
    Genera la curva pre-catalyst con bande di confidenza calibrate empiricamente
    per un singolo row di simulazione/catalyst.

    Estrae i campi tecnici presenti nel row e chiama
    ``prediction.curve_forecast.forecast_precat_curve``.

    Ritorna ``CurveForecast.as_dict()`` oppure ``None`` se ``days_to_t`` non è
    disponibile o ≤ 0 (già passato il CD).
    """
    from prediction.curve_forecast import forecast_precat_curve

    days_to_t = row.get("days_to_t")
    try:
        d = int(days_to_t) if days_to_t is not None else None
    except (TypeError, ValueError):
        d = None

    if d is None or d <= 0:
        return None  # CD già passato o data non disponibile

    try:
        fc = forecast_precat_curve(
            slope_20d=row.get("slope_20d"),
            slope_5d=row.get("slope_5d"),
            run_up_30d=row.get("run_up_30d"),
            run_up_7d=row.get("run_up_7d"),
            days_to_cd=d,
        )
    except Exception:
        return None

    return fc.as_dict()


def predict_catalyst_with_engine(
    sim_rows: list,
    *,
    config: PredictionConfig | None = None,
    engine: str | None = None,
) -> dict:
    """
    Same as ``predict_catalyst``; when ``engine`` / ``PRED_ENGINE`` is ``v5``,
    attaches ``v5_curves`` keyed by ticker (prototype, does not replace v4 preds).

    Sempre (indipendentemente dall'engine) allega ``precat_curves`` con la
    curva pre-catalyst calibrata empiricamente per ogni ticker.
    """
    result = predict_catalyst(sim_rows, config=config)

    # ── Curva pre-catalyst (sempre attiva, tutti gli engine) ─────────────────
    precat_curves: dict[str, Any] = {}
    for row in sim_rows or []:
        tk = str(row.get("ticker") or "").strip().upper()
        if not tk:
            continue
        fc_dict = forecast_precat_curve_for_row(row)
        if fc_dict is not None:
            precat_curves[tk] = fc_dict
    if isinstance(result, dict) and precat_curves:
        result = dict(result)
        result["precat_curves"] = precat_curves

    # ── v5 fan chart (solo con PRED_ENGINE=v5) ───────────────────────────────
    eng = (engine or pred_engine()).strip().lower()
    if eng != "v5":
        return result
    v5_curves: dict[str, Any] = {}
    for row in sim_rows or []:
        tk = str(row.get("ticker") or "").strip().upper()
        if not tk:
            continue
        v5_curves[tk] = predict_v5_curve_for_row(row)
    if isinstance(result, dict):
        result = dict(result)
        result["v5_curves"] = v5_curves
        result["pred_engine"] = "v5"
    return result
