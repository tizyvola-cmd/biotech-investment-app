"""
Node-based backtesting and evaluation for Supernova pre-catalyst predictions.

CORE PRINCIPLE: evaluate model predictions at calendar nodes (T-60 … T+7),
using predictions frozen at the retro decision point (T-10 calendar before CD)
and realized prices vs T-60 — no look-ahead.

Primary data: ``data/past_catalyst_predictions.json``
Cache output: ``data/evaluation_results.json``
"""
from __future__ import annotations

import json
import math
import statistics
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.signal_filters import (
    apply_rotation_veto,
    apply_up_confidence_gate,
    direction_to_sign,
    is_slope_rotation,
    up_confidence_gate_passes,
)

EVAL_RESULTS_PATH = Path("data") / "evaluation_results.json"
EVAL_BASELINE_PATH = Path("data") / "evaluation_results_baseline.json"
DECISION_OFFSET_CAL = -10  # RETRO_DECISION_DAYS_BEFORE_CD (SIM_PRED_HORIZON_CAL_DAYS)
DECISION_CLOSE_KEY = "close_m10"  # price at retro decision point (~T-10 cal)
SEQ_OFFSETS = (-60, -30, -10, -7, -5, -3, 4, 7)
MIN_SAMPLES_FLAG = 5

NODE_CHECKPOINTS: tuple[tuple[str, int, str, str], ...] = (
    ("T-60", -60, "model_dm60_pct", "close_m60"),
    ("T-30", -30, "model_dm30_pct", "close_m30"),
    ("T-10", -10, "model_dm10_pct", "close_m10"),
    ("T-7", -7, "model_dm7_pct", "close_m7"),
    ("T-5", -5, "model_dm5_pct", "close_m5"),
    ("T-3", -3, "model_dm3_pct", "close_m3"),
    ("T+4", 4, "model_d4_pct", "close_p4"),
    ("T+7", 7, "model_d7_pct", "close_p7"),
)

LAYER_NODES = ("T-5", "T-3")


def _float_or_none(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def _parse_cd(rec: dict) -> date | None:
    cd = rec.get("completion_date")
    if isinstance(cd, date):
        return cd
    if isinstance(cd, str) and cd.strip():
        try:
            return date.fromisoformat(cd.strip()[:10])
        except ValueError:
            return None
    return None


def _is_past_catalyst(rec: dict, *, today: date | None = None) -> bool:
    cd = _parse_cd(rec)
    if cd is None:
        return False
    ref = today or date.today()
    return cd < ref


def actual_pct_at_node(rec: dict, close_key: str) -> float | None:
    """
    Realized % vs the retro decision price (T-10 cal, ``close_m10``).

    Past-catalyst ``model_dm*`` fields are expressed vs the same decision
    reference (``p_ref`` at ``ref_d = CD - 10``) — **not** vs T-60.
    Using ``close_m60`` as baseline inflates MAE (look-alike bias).
    """
    base = _float_or_none(rec.get(DECISION_CLOSE_KEY))
    px = _float_or_none(rec.get(close_key))
    if base is None or px is None or base <= 0:
        return None
    if close_key == DECISION_CLOSE_KEY:
        return 0.0
    return round((px / base - 1.0) * 100.0, 4)


def actual_pct_vs_m60(rec: dict, close_key: str) -> float | None:
    """Legacy % vs T-60 — kept for diagnostics only."""
    base = _float_or_none(rec.get("close_m60"))
    px = _float_or_none(rec.get(close_key))
    if base is None or px is None or base <= 0:
        return None
    if close_key == "close_m60":
        return 0.0
    return round((px / base - 1.0) * 100.0, 4)


def pred_base_at_node(rec: dict, pred_key: str) -> float | None:
    """Model prediction (as-of T-10) for the node horizon."""
    return _float_or_none(rec.get(pred_key))


def pred_raw_fit_at_node(rec: dict, pred_key: str) -> float | None:
    """Layer i OFF — polinomio grezzo (``*_fit_pct`` se presente)."""
    from prediction.blend_ab_eval import pred_raw_fit_at_key

    return pred_raw_fit_at_key(rec, pred_key)


def pred_emp_blend_at_node(rec: dict, pred_key: str) -> float | None:
    """Layer i ON — blend empirico su orizzonti fit (o ``model_dm*`` live)."""
    from prediction.blend_ab_eval import has_fit_horizons, pred_at_model_key

    return pred_at_model_key(rec, pred_key, blended=True)


def pred_eis_at_node(rec: dict, pred_key: str) -> float | None:
    base = pred_base_at_node(rec, pred_key)
    if base is None:
        return None
    shift = _float_or_none(rec.get("eis_poly_shift_pp")) or 0.0
    return round(base + shift, 4)


def _seq_index(offset: int) -> int | None:
    try:
        return SEQ_OFFSETS.index(offset)
    except ValueError:
        return None


def pred_seq_at_node(rec: dict, offset: int) -> float | None:
    seq = rec.get("seq_curve_pct_vs_m60")
    if not isinstance(seq, list):
        return None
    idx = _seq_index(offset)
    if idx is None or idx >= len(seq):
        return None
    return _float_or_none(seq[idx])


def pred_daily_at_node(rec: dict, pred_key: str, offset: int) -> float | None:
    """
    Historical proxy for daily-open anchor: shift base prediction by the gap
    between realized price at decision (T-10) and model expectation at T-10.
    """
    base = pred_base_at_node(rec, pred_key)
    if base is None:
        return None
    act_dec = actual_pct_at_node(rec, DECISION_CLOSE_KEY)
    pred_dec = pred_base_at_node(rec, "model_dm10_pct")
    if act_dec is None or pred_dec is None:
        return base
    shift = act_dec - pred_dec
    if abs(shift) < 0.02:
        return base
    return round(base + shift, 4)


def pred_full_at_node(rec: dict, pred_key: str, offset: int) -> float | None:
    eis = pred_eis_at_node(rec, pred_key)
    seq = pred_seq_at_node(rec, offset)
    daily = pred_daily_at_node(rec, pred_key, offset)
    if seq is not None:
        base = seq
    elif eis is not None:
        base = eis
    elif daily is not None:
        base = daily
    else:
        return None
    if daily is not None and seq is None:
        return daily
    return base


def _sign_pct(v: float | None, band: float = 0.5) -> int:
    if v is None:
        return 0
    if v > band:
        return 1
    if v < -band:
        return -1
    return 0


def _aggregate_node_metrics(pairs: list[tuple[float, float]]) -> dict[str, Any]:
    if not pairs:
        return {
            "mae": None,
            "rmse": None,
            "direction_accuracy": None,
            "bias": None,
            "n_samples": 0,
        }
    errs = [p - a for p, a in pairs]
    abs_errs = [abs(e) for e in errs]
    dir_hits = [
        1
        for (p, a) in pairs
        if _sign_pct(p) == _sign_pct(a) and (_sign_pct(p) != 0 or _sign_pct(a) != 0)
    ]
    dir_n = sum(
        1 for p, a in pairs if _sign_pct(p) != 0 or _sign_pct(a) != 0
    )
    return {
        "mae": round(statistics.mean(abs_errs), 3),
        "rmse": round(math.sqrt(statistics.mean([e * e for e in errs])), 3),
        "direction_accuracy": round(sum(dir_hits) / dir_n, 3) if dir_n else None,
        "bias": round(statistics.mean(errs), 3),
        "n_samples": len(pairs),
    }


def _best_worst_cases(
    rows: list[dict], limit: int = 5
) -> tuple[list[dict], list[dict]]:
    ranked = sorted(rows, key=lambda r: abs(r["error"]))
    best = [
        {
            "ticker": r["ticker"],
            "cd_date": r["cd_date"],
            "pred_pct": r["pred_pct"],
            "actual_pct": r["actual_pct"],
            "error": r["error"],
        }
        for r in ranked[:limit]
    ]
    worst = [
        {
            "ticker": r["ticker"],
            "cd_date": r["cd_date"],
            "pred_pct": r["pred_pct"],
            "actual_pct": r["actual_pct"],
            "error": r["error"],
        }
        for r in ranked[-limit:][::-1]
    ]
    return best, worst


def evaluate_nodes(
    rows: dict[str, dict],
    *,
    today: date | None = None,
    min_samples: int = MIN_SAMPLES_FLAG,
) -> dict[str, Any]:
    """Part 1 — node-based accuracy."""
    filtered = {k: normalize_past_pred_record(dict(v)) for k, v in rows.items() if _is_past_catalyst(v, today=today)}
    total = len(filtered)
    node_results: list[dict] = []

    for label, offset, pred_key, close_key in NODE_CHECKPOINTS:
        pairs: list[tuple[float, float]] = []
        case_rows: list[dict] = []
        for key, rec in filtered.items():
            pred = pred_base_at_node(rec, pred_key)
            act = actual_pct_at_node(rec, close_key)
            if pred is None or act is None:
                continue
            pairs.append((pred, act))
            case_rows.append(
                {
                    "ticker": str(rec.get("ticker") or key.split("|")[0]),
                    "cd_date": str(rec.get("completion_date", ""))[:10],
                    "pred_pct": round(pred, 2),
                    "actual_pct": round(act, 2),
                    "error": round(pred - act, 2),
                }
            )
        metrics = _aggregate_node_metrics(pairs)
        best, worst = _best_worst_cases(case_rows)
        coverage = round(len(pairs) / total, 3) if total else 0.0
        node_results.append(
            {
                "node": label,
                "offset": offset,
                "decision_as_of": f"T{DECISION_OFFSET_CAL}",
                "baseline": f"{DECISION_CLOSE_KEY} (retro decision price)",
                **metrics,
                "coverage": coverage,
                "best_cases": best,
                "worst_cases": worst,
                "insufficient_data": metrics["n_samples"] < min_samples,
            }
        )
    return {
        "total_tickers": total,
        "decision_offset_cal": DECISION_OFFSET_CAL,
        "nodes": node_results,
        "methodology_note": (
            "Predictions are frozen at T-10 calendar before CD (retro decision point). "
            "Actuals are realized closes vs the same decision price (close_m10). "
            "No look-ahead. Live sheet curves use T-60 anchor; retro past_catalyst uses T-10 ref."
        ),
    }


def evaluate_layer_deltas(
    rows: dict[str, dict],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Part 2 — layer delta vs raw polynomial at T-5 and T-3."""
    filtered = {k: v for k, v in rows.items() if _is_past_catalyst(v, today=today)}
    layers = [
        ("raw_polynomial", lambda r, pk, off: pred_raw_fit_at_node(r, pk)),
        ("emp_precat_blend", lambda r, pk, off: pred_emp_blend_at_node(r, pk)),
        ("base_polynomial", lambda r, pk, off: pred_base_at_node(r, pk)),
        ("seq_calib", lambda r, pk, off: pred_seq_at_node(r, off)),
        ("eis_shift", lambda r, pk, off: pred_eis_at_node(r, pk)),
        ("daily_open_anchor", lambda r, pk, off: pred_daily_at_node(r, pk, off)),
        ("full_model", lambda r, pk, off: pred_full_at_node(r, pk, off)),
    ]
    node_map = {label: (off, pk, ck) for label, off, pk, ck in NODE_CHECKPOINTS}

    out_nodes: dict[str, list[dict]] = {}
    for node_label in LAYER_NODES:
        offset, pred_key, close_key = node_map[node_label]
        layer_stats: list[dict] = []
        base_mae: float | None = None
        base_dir: float | None = None

        for lay_name, pred_fn in layers:
            pairs: list[tuple[float, float]] = []
            for rec in filtered.values():
                pred = pred_fn(rec, pred_key, offset)
                act = actual_pct_at_node(rec, close_key)
                if pred is None or act is None:
                    continue
                pairs.append((pred, act))
            m = _aggregate_node_metrics(pairs)
            if lay_name == "raw_polynomial":
                base_mae = m["mae"]
                base_dir = m["direction_accuracy"]
            delta_mae = None
            delta_dir = None
            if base_mae is not None and m["mae"] is not None:
                delta_mae = round(m["mae"] - base_mae, 3)
            if base_dir is not None and m["direction_accuracy"] is not None:
                delta_dir = round(m["direction_accuracy"] - base_dir, 3)
            layer_stats.append(
                {
                    "layer": lay_name,
                    "node": node_label,
                    "mae": m["mae"],
                    "direction_accuracy": m["direction_accuracy"],
                    "n_samples": m["n_samples"],
                    "delta_mae_vs_base": delta_mae,
                    "delta_dir_acc_vs_base": delta_dir,
                }
            )
        out_nodes[node_label] = layer_stats
    return {"nodes": out_nodes}


def _forward_return(rec: dict, start_close: str, end_close: str) -> float | None:
    s = _float_or_none(rec.get(start_close))
    e = _float_or_none(rec.get(end_close))
    if s is None or e is None or s <= 0:
        return None
    return round((e / s - 1.0) * 100.0, 4)


def evaluate_slope_signals(
    rows: dict[str, dict],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Part 3 — slope signals at correct horizons (from T-10 decision proxy)."""
    filtered = {k: v for k, v in rows.items() if _is_past_catalyst(v, today=today)}

    specs = [
        ("slope5", "slope_5d", "close_m10", "close_m5", 5),
        ("slope20", "slope_20d", "close_m10", "close_m30", 20),
        ("rotation", "slope_5d", "close_m10", "close_m7", 3),
    ]
    results: list[dict] = []
    veto_events = 0
    veto_would_help = 0
    veto_total_up = 0

    for sig_name, slope_key, start_ck, end_ck, horizon_days in specs:
        hits = 0
        n = 0
        fp = fn = 0
        abs_errs: list[float] = []
        for rec in filtered.values():
            slope = _float_or_none(rec.get(slope_key))
            if sig_name == "rotation":
                s5 = _float_or_none(rec.get("slope_5d"))
                s20 = _float_or_none(rec.get("slope_20d"))
                if not is_slope_rotation(s5, s20):
                    continue
                slope = (s5 or 0) - (s20 or 0)
            if slope is None:
                continue
            actual = _forward_return(rec, start_ck, end_ck)
            if actual is None:
                continue
            pred = slope * horizon_days
            abs_errs.append(abs(pred - actual))
            ps = _sign_pct(pred, 0.3)
            as_ = _sign_pct(actual, 0.3)
            if ps != 0 or as_ != 0:
                n += 1
                if ps == as_:
                    hits += 1
                if ps == 1 and as_ == -1:
                    fp += 1
                if ps == -1 and as_ == 1:
                    fn += 1
        results.append(
            {
                "signal": sig_name,
                "horizon_trading_days": horizon_days,
                "direction_accuracy": round(hits / n, 3) if n else None,
                "mae_pct": round(statistics.mean(abs_errs), 3) if abs_errs else None,
                "false_positive_rate": round(fp / n, 3) if n else None,
                "false_negative_rate": round(fn / n, 3) if n else None,
                "n_samples": n,
            }
        )

    # Rotation veto backtest on UP signals
    for rec in filtered.values():
        d = str(rec.get("dir_v4") or "")
        if not d.startswith("↑"):
            continue
        s5 = _float_or_none(rec.get("slope_5d"))
        s20 = _float_or_none(rec.get("slope_20d"))
        actual = _forward_return(rec, "close_m10", "close_m5")
        if actual is None:
            continue
        veto_total_up += 1
        if is_slope_rotation(s5, s20):
            veto_events += 1
            raw_hit = actual > 0
            if not raw_hit:
                veto_would_help += 1

    rotation_veto = {
        "up_signals_total": veto_total_up,
        "veto_would_fire": veto_events,
        "veto_fire_rate": round(veto_events / veto_total_up, 3) if veto_total_up else None,
        "veto_avoids_false_up": veto_would_help,
        "note": "Counts UP (dir_v4) signals where rotation veto would suppress a losing forward 5d move.",
    }
    return {"signals": results, "rotation_veto": rotation_veto}


def evaluate_up_filter(
    rows: dict[str, dict],
    *,
    today: date | None = None,
    min_pre_cd_days: int = 20,
) -> dict[str, Any]:
    """
    Part 4 — UP confidence gate before/after.

    Uses records with ``pre_catalyst_days >= min_pre_cd_days`` so the gate's
    ``days_to_CD > 14`` condition can pass (decision at T-10 still has 10 days
    — we proxy early-cycle UP using longer pre-CD history tickers only).
    """
    filtered = {k: v for k, v in rows.items() if _is_past_catalyst(v, today=today)}
    raw_up = filtered_up = 0
    raw_hits = filt_hits = 0
    suppressed = 0

    for rec in filtered.values():
        pre_cd = _float_or_none(rec.get("pre_catalyst_days"))
        if pre_cd is not None and pre_cd < min_pre_cd_days:
            continue
        d = str(rec.get("dir_v4") or "")
        if not d.startswith("↑"):
            continue
        actual = _forward_return(rec, "close_m10", "close_m5")
        if actual is None:
            actual = _float_or_none(rec.get("d5_pct"))
        if actual is None:
            continue
        days_to_cd = int(pre_cd) if pre_cd is not None else DECISION_OFFSET_CAL
        raw_up += 1
        if actual > 0.5:
            raw_hits += 1

        ok, _reasons = up_confidence_gate_passes(
            slope_5d=_float_or_none(rec.get("slope_5d")),
            slope_20d=_float_or_none(rec.get("slope_20d")),
            vol_ratio=_float_or_none(rec.get("vol_ratio")),
            rsi_14=_float_or_none(rec.get("rsi_14")),
            days_to_cd=days_to_cd if days_to_cd > DECISION_OFFSET_CAL else 20,
        )
        if not ok:
            suppressed += 1
            continue
        filtered_up += 1
        if actual > 0.5:
            filt_hits += 1

    return {
        "before": {
            "up_signals": raw_up,
            "direction_accuracy": round(raw_hits / raw_up, 3) if raw_up else None,
        },
        "after_filter": {
            "up_signals": filtered_up,
            "suppressed": suppressed,
            "suppression_rate": round(suppressed / raw_up, 3) if raw_up else None,
            "direction_accuracy": round(filt_hits / filtered_up, 3) if filtered_up else None,
        },
        "gate_conditions": [
            "slope5 > 0 AND slope20 > 0",
            "vol_ratio > 1.2",
            "RSI_14 < 65",
            "abs(slope5 - slope20) < 0.5",
            f"days_to_CD > 14 (subset pre_catalyst_days >= {min_pre_cd_days})",
        ],
        "subset_note": (
            "Full UP gate at T-10 suppresses all UP (days_to_CD=10). "
            "Backtest uses long pre-CD history names with relaxed days proxy."
        ),
    }


def _worst_persistent_errors(rows: dict[str, dict], *, today: date | None = None) -> list[dict]:
    """Tickers with highest mean |error| across available nodes."""
    filtered = {k: v for k, v in rows.items() if _is_past_catalyst(v, today=today)}
    by_ticker: dict[str, list[float]] = {}
    meta: dict[str, str] = {}
    for key, rec in filtered.items():
        tk = str(rec.get("ticker") or key.split("|")[0])
        meta[tk] = str(rec.get("completion_date", ""))[:10]
        for label, _off, pred_key, close_key in NODE_CHECKPOINTS:
            pred = pred_base_at_node(rec, pred_key)
            act = actual_pct_at_node(rec, close_key)
            if pred is None or act is None:
                continue
            by_ticker.setdefault(tk, []).append(abs(pred - act))
    ranked = sorted(
        (
            {
                "ticker": tk,
                "cd_date": meta.get(tk, ""),
                "mean_abs_error": round(statistics.mean(errs), 2),
                "nodes_evaluated": len(errs),
            }
            for tk, errs in by_ticker.items()
            if len(errs) >= 3
        ),
        key=lambda x: x["mean_abs_error"],
        reverse=True,
    )
    return ranked[:15]


def _mock_node_results() -> list[dict]:
    """Synthetic U-shaped MAE when historical snapshots are sparse."""
    u_shape = [8.5, 5.2, 3.8, 2.9, 2.1, 2.4, 3.6, 6.8]
    out = []
    for i, (label, offset, _, _) in enumerate(NODE_CHECKPOINTS):
        mae = u_shape[i]
        out.append(
            {
                "node": label,
                "offset": offset,
                "decision_as_of": f"T{DECISION_OFFSET_CAL}",
                "baseline": f"{DECISION_CLOSE_KEY} (retro decision price)",
                "mae": mae,
                "rmse": round(mae * 1.25, 2),
                "direction_accuracy": round(max(0.45, 0.72 - mae * 0.03), 3),
                "bias": round(0.3 + (i - 4) * 0.15, 2),
                "n_samples": 12,
                "coverage": 0.35,
                "best_cases": [],
                "worst_cases": [],
                "insufficient_data": True,
                "mock": True,
            }
        )
    return out


def run_full_evaluation(
    tickers: list[str] | None = None,
    *,
    lookback_cds: int = 10,
    json_path: str | Path | None = None,
    use_mock_if_sparse: bool = True,
    today: date | None = None,
) -> dict[str, Any]:
    """
    Run complete evaluation pipeline. Persists to ``data/evaluation_results.json``.
    """
    path = Path(json_path or PAST_CATALYST_PREDICTIONS_JSON)
    rows = load_past_pred_map(str(path))
    ref_today = today or date.today()

    if tickers:
        tk_set = {t.upper() for t in tickers}
        rows = {
            k: v
            for k, v in rows.items()
            if str(v.get("ticker", k.split("|")[0])).upper() in tk_set
        }

    # Optional lookback cap per ticker (most recent N CDs)
    if lookback_cds and lookback_cds > 0:
        by_tk: dict[str, list[tuple[str, dict]]] = {}
        for k, v in rows.items():
            if not _is_past_catalyst(v, today=ref_today):
                continue
            tk = str(v.get("ticker", k.split("|")[0])).upper()
            by_tk.setdefault(tk, []).append((k, v))
        trimmed: dict[str, dict] = {}
        for tk, items in by_tk.items():
            items.sort(key=lambda x: str(x[1].get("completion_date", ""))[:10], reverse=True)
            for k, v in items[:lookback_cds]:
                trimmed[k] = v
        if trimmed:
            rows = trimmed

    nodes = evaluate_nodes(rows, today=ref_today)
    sparse = all(n.get("n_samples", 0) < MIN_SAMPLES_FLAG for n in nodes["nodes"])
    if sparse and use_mock_if_sparse:
        nodes["nodes"] = _mock_node_results()
        nodes["mock_fallback"] = True
        nodes["mock_reason"] = "Fewer than 5 samples per node in past_catalyst — showing synthetic U-shape for UI structure."

    try:
        from prediction.blend_ab_eval import evaluate_blend_ab

        blend_ab = evaluate_blend_ab(source="all", past_only=True, today=ref_today)
    except Exception as exc:
        blend_ab = {"error": str(exc)[:200], "summary": {"n": 0}}

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": str(path),
        "lookback_cds": lookback_cds,
        "node_accuracy": nodes,
        "layer_deltas": evaluate_layer_deltas(rows, today=ref_today),
        "blend_ab": blend_ab,
        "slope_signals": evaluate_slope_signals(rows, today=ref_today),
        "up_filter": evaluate_up_filter(rows, today=ref_today),
        "worst_cases": _worst_persistent_errors(rows, today=ref_today),
        "expected_u_shape": (
            "MAE should be highest at T-60/T+7, improving toward T-5/T-3. "
            "Flat or inverted curve suggests baseline mismatch or look-ahead."
        ),
    }

    EVAL_RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVAL_RESULTS_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    return result


def load_cached_evaluation(path: Path | str | None = None) -> dict[str, Any]:
    p = Path(path or EVAL_RESULTS_PATH)
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_evaluation_baseline(
    *,
    source_path: Path | str | None = None,
    dest_path: Path | str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    """Copy latest evaluation cache to baseline file for before/after comparison."""
    current = load_cached_evaluation(source_path)
    if not current:
        raise ValueError("Nessuna valutazione in cache — esegui prima run_full_evaluation")
    doc = dict(current)
    doc["saved_as_baseline_at"] = (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    if label and label.strip():
        doc["baseline_label"] = label.strip()
    p = Path(dest_path or EVAL_BASELINE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return doc


def load_evaluation_baseline(path: Path | str | None = None) -> dict[str, Any]:
    p = Path(path or EVAL_BASELINE_PATH)
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _node_map(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    nodes = (doc.get("node_accuracy") or {}).get("nodes") or []
    return {str(n.get("node")): n for n in nodes if isinstance(n, dict) and n.get("node")}


def _layer_row(doc: dict[str, Any], node_label: str, layer: str) -> dict[str, Any] | None:
    layers = ((doc.get("layer_deltas") or {}).get("nodes") or {}).get(node_label) or []
    for row in layers:
        if isinstance(row, dict) and row.get("layer") == layer:
            return row
    return None


def _slope_row(doc: dict[str, Any], signal: str) -> dict[str, Any] | None:
    for row in (doc.get("slope_signals") or {}).get("signals") or []:
        if isinstance(row, dict) and row.get("signal") == signal:
            return row
    return None


def compare_evaluations(
    current: dict[str, Any],
    baseline: dict[str, Any],
) -> dict[str, Any]:
    """Delta current − baseline (MAE down / dir acc up = improvement)."""
    cur_nodes = _node_map(current)
    base_nodes = _node_map(baseline)
    node_labels = [
        "T-60", "T-30", "T-10", "T-7", "T-5", "T-3", "T+4", "T+7",
    ]
    nodes_out: list[dict[str, Any]] = []
    for label in node_labels:
        c = cur_nodes.get(label) or {}
        b = base_nodes.get(label) or {}
        c_mae, b_mae = c.get("mae"), b.get("mae")
        c_dir, b_dir = c.get("direction_accuracy"), b.get("direction_accuracy")
        mae_delta = None
        dir_delta_pp = None
        if c_mae is not None and b_mae is not None:
            mae_delta = round(float(c_mae) - float(b_mae), 3)
        if c_dir is not None and b_dir is not None:
            dir_delta_pp = round((float(c_dir) - float(b_dir)) * 100.0, 2)
        nodes_out.append(
            {
                "node": label,
                "mae_current": c_mae,
                "mae_baseline": b_mae,
                "mae_delta": mae_delta,
                "dir_acc_current": c_dir,
                "dir_acc_baseline": b_dir,
                "dir_acc_delta_pp": dir_delta_pp,
            }
        )

    layer_names = [
        "raw_polynomial",
        "emp_precat_blend",
        "base_polynomial",
        "seq_calib",
        "eis_shift",
        "daily_open_anchor",
        "full_model",
    ]
    layers_out: list[dict[str, Any]] = []
    for layer in layer_names:
        c = _layer_row(current, "T-5", layer) or {}
        b = _layer_row(baseline, "T-5", layer) or {}
        c_dm, b_dm = c.get("delta_mae_vs_base"), b.get("delta_mae_vs_base")
        c_dd, b_dd = c.get("delta_dir_acc_vs_base"), b.get("delta_dir_acc_vs_base")
        layers_out.append(
            {
                "layer": layer,
                "mae_current": c.get("mae"),
                "mae_baseline": b.get("mae"),
                "delta_mae_vs_base_current": c_dm,
                "delta_mae_vs_base_baseline": b_dm,
                "delta_mae_vs_base_change": (
                    round(float(c_dm) - float(b_dm), 3)
                    if c_dm is not None and b_dm is not None
                    else None
                ),
                "delta_dir_change_pp": (
                    round((float(c_dd) - float(b_dd)) * 100.0, 2)
                    if c_dd is not None and b_dd is not None
                    else None
                ),
            }
        )

    slopes_out: list[dict[str, Any]] = []
    for sig in ("slope5", "slope20", "rotation"):
        c = _slope_row(current, sig) or {}
        b = _slope_row(baseline, sig) or {}
        c_dir, b_dir = c.get("direction_accuracy"), b.get("direction_accuracy")
        slopes_out.append(
            {
                "signal": sig,
                "dir_acc_current": c_dir,
                "dir_acc_baseline": b_dir,
                "dir_acc_delta_pp": (
                    round((float(c_dir) - float(b_dir)) * 100.0, 2)
                    if c_dir is not None and b_dir is not None
                    else None
                ),
            }
        )

    t5_c = cur_nodes.get("T-5") or {}
    t5_b = base_nodes.get("T-5") or {}
    s5_c = _slope_row(current, "slope5") or {}
    s5_b = _slope_row(baseline, "slope5") or {}
    seq_c = _layer_row(current, "T-5", "seq_calib") or {}
    seq_b = _layer_row(baseline, "T-5", "seq_calib") or {}

    lookback_c = current.get("lookback_cds")
    lookback_b = baseline.get("lookback_cds")
    warning = None
    if lookback_c != lookback_b:
        warning = (
            f"Lookback diverso (baseline={lookback_b}, corrente={lookback_c}) — "
            "confronta solo con lo stesso lookback."
        )

    def _delta_mae(a, b):
        if a is None or b is None:
            return None
        return round(float(a) - float(b), 3)

    def _delta_dir_pp(a, b):
        if a is None or b is None:
            return None
        return round((float(a) - float(b)) * 100.0, 2)

    return {
        "baseline_at": baseline.get("saved_as_baseline_at") or baseline.get("generated_at"),
        "baseline_label": baseline.get("baseline_label"),
        "current_at": current.get("generated_at"),
        "lookback_baseline": lookback_b,
        "lookback_current": lookback_c,
        "warning": warning,
        "nodes": nodes_out,
        "layers_t5": layers_out,
        "slopes": slopes_out,
        "summary": {
            "mae_t5_delta": _delta_mae(t5_c.get("mae"), t5_b.get("mae")),
            "dir_t5_delta_pp": _delta_dir_pp(
                t5_c.get("direction_accuracy"), t5_b.get("direction_accuracy")
            ),
            "slope5_dir_delta_pp": _delta_dir_pp(
                s5_c.get("direction_accuracy"), s5_b.get("direction_accuracy")
            ),
            "seq_delta_mae_vs_base_change": (
                round(float(seq_c.get("delta_mae_vs_base")) - float(seq_b.get("delta_mae_vs_base")), 3)
                if seq_c.get("delta_mae_vs_base") is not None
                and seq_b.get("delta_mae_vs_base") is not None
                else None
            ),
        },
        "interpretation": (
            "mae_delta < 0 = miglioramento errore; dir_acc_delta_pp > 0 = miglior direzione; "
            "seq_delta_mae_vs_base_change < 0 = seq calib aiuta di più vs base."
        ),
    }


__all__ = [
    "EVAL_BASELINE_PATH",
    "EVAL_RESULTS_PATH",
    "NODE_CHECKPOINTS",
    "actual_pct_at_node",
    "actual_pct_vs_m60",
    "compare_evaluations",
    "evaluate_layer_deltas",
    "evaluate_nodes",
    "evaluate_slope_signals",
    "evaluate_up_filter",
    "load_cached_evaluation",
    "load_evaluation_baseline",
    "run_full_evaluation",
    "save_evaluation_baseline",
]
