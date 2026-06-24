"""
Regime multiplier — correct systematic over/undershoot by market regime.

Uses ``market_context_gate`` for RISK_ON / NEUTRAL / RISK_OFF / CRISIS.
Minimum REGIME_MIN_SAMPLES outcomes per regime before activating.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import (
    LEARNING_HISTORY_JSON,
    OUTCOMES_WITH_REGIME_JSON,
    REGIME_HISTORY_JSON,
    REGIME_MULTIPLIERS_JSON,
)
from prediction.calibration_circuit_breaker import evaluate_circuit_breaker

logger = logging.getLogger(__name__)

# Minimum resolved outcomes per regime before a multiplier may move off 1.0.
# A small sample is dominated by noise (a 34-row regime sub-pool showed 41%
# direction accuracy while the full pool sits at ~51%), so the threshold is set
# high enough to require a representative sample. Override via env for tuning.
REGIME_MIN_SAMPLES = int(os.getenv("REGIME_MIN_SAMPLES", "30"))
REGIME_MULT_FLOOR = 0.7
REGIME_MULT_CEILING = 1.3
# Below this in-sample direction accuracy the regime sample is directionally
# unreliable: scaling magnitude would amplify wrong-signed predictions, so the
# multiplier is held at 1.0 instead of "correcting" a broken sample.
REGIME_MIN_DIRECTION_ACC = 0.5
# Ridge prior centred at 1.0. The raw least-squares scalar overfits the
# magnitude ratio (timid predictions vs volatile actuals) and pins the
# multiplier to a 0.7/1.3 rail even when the mean bias is tiny. Shrinking the
# OLS estimate toward 1.0 (m = (m_ols + k) / (1 + k)) makes it track the modest
# real bias instead of chasing volatility. Higher k = stronger shrink.
REGIME_SHRINK_PRIOR = 2.0
# Require at least this fractional in-sample MAE reduction before moving off 1.0.
REGIME_MIN_REL_IMPROVEMENT = 0.01
# Unpredictable tail moves (binary readouts) above this |actual| pp are dropped
# from the magnitude regression so a few jumps cannot dominate the scalar.
REGIME_OUTLIER_ACTUAL_PP = 50.0
ACTIVE_REGIMES = ("RISK_ON", "NEUTRAL", "RISK_OFF")
UNKNOWN_REGIME = "UNKNOWN"

MarketRegime = Literal["RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _today_iso() -> str:
    return date.today().isoformat()


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _save_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


_regime_doc_cache: tuple[float, dict[str, Any]] | None = None


def invalidate_regime_multiplier_cache() -> None:
    global _regime_doc_cache
    _regime_doc_cache = None


def _regime_json_mtime() -> float:
    path = Path(REGIME_MULTIPLIERS_JSON)
    try:
        return path.stat().st_mtime if path.is_file() else 0.0
    except OSError:
        return 0.0


def load_regime_multipliers() -> dict[str, Any]:
    global _regime_doc_cache
    mtime = _regime_json_mtime()
    if _regime_doc_cache is not None and _regime_doc_cache[0] == mtime:
        return _regime_doc_cache[1]
    doc = _load_json(Path(REGIME_MULTIPLIERS_JSON), {})
    regimes = doc.get("regimes") if isinstance(doc, dict) and "regimes" in doc else doc
    if not isinstance(regimes, dict):
        regimes = {}
    _regime_doc_cache = (mtime, regimes)
    return regimes


def build_regime_multiplier_map() -> dict[str, float]:
    factors = load_regime_multipliers()
    out: dict[str, float] = {}
    for regime in ACTIVE_REGIMES:
        entry = factors.get(regime) if isinstance(factors, dict) else None
        if not isinstance(entry, dict) or entry.get("status") == "insufficient_data":
            out[regime] = 1.0
            continue
        mult = entry.get("multiplier")
        try:
            out[regime] = float(mult) if mult is not None else 1.0
        except (TypeError, ValueError):
            out[regime] = 1.0
    return out


def get_current_regime() -> MarketRegime:
    from prediction.market_context_gate import load_market_context

    doc = load_market_context()
    regime = str(doc.get("regime") or "NEUTRAL").upper()
    if regime in ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"):
        return regime  # type: ignore[return-value]
    return "NEUTRAL"


def load_regime_history() -> dict[str, str]:
    """Daily ``date -> regime`` map, seeded from market_context history when empty.

    The dedicated ``regime_history.json`` accumulates one regime per day going
    forward (see :func:`record_daily_regime`). Until it is populated we seed from
    the rolling ``market_context.history_7d`` window (last write per day wins).
    """
    doc = _load_json(Path(REGIME_HISTORY_JSON), {})
    by_date = doc.get("by_date") if isinstance(doc, dict) else None
    out: dict[str, str] = {}
    if isinstance(by_date, dict):
        for d, r in by_date.items():
            rr = str(r or "").upper()
            if rr in ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"):
                out[str(d)[:10]] = rr
    if out:
        return out
    from prediction.market_context_gate import load_market_context

    for e in load_market_context().get("history_7d") or []:
        d = str(e.get("ts") or "")[:10]
        rr = str(e.get("regime") or "").upper()
        if d and rr in ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"):
            out[d] = rr
    return out


def record_daily_regime(iso_date: str, regime: str) -> None:
    """Persist the classified regime for a day so historical outcomes can be
    attributed to the regime that was actually in force at prediction time."""
    d = str(iso_date or "")[:10]
    rr = str(regime or "").upper()
    if not d or rr not in ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"):
        return
    path = Path(REGIME_HISTORY_JSON)
    doc = _load_json(path, {"schema_version": 1, "by_date": {}})
    by_date = doc.get("by_date") if isinstance(doc, dict) else None
    if not isinstance(by_date, dict):
        by_date = {}
    by_date[d] = rr
    _save_json(path, {"schema_version": 1, "updated_at": _now_iso(), "by_date": by_date})


def get_regime_at_date(iso_date: str) -> str:
    """Regime in force at ``iso_date``.

    Today/empty resolve to the live regime; past dates are looked up in the
    persisted regime history. Crucially this never stamps the *current* regime
    onto old outcomes — doing so funnelled the entire pool into one regime and
    starved the others below the activation threshold. Unknown past dates return
    ``UNKNOWN`` and are excluded from per-regime calibration.
    """
    d = str(iso_date or "")[:10]
    if not d or d >= _today_iso():
        return get_current_regime()
    return load_regime_history().get(d, UNKNOWN_REGIME)


def load_outcomes_with_regime() -> list[dict[str, Any]]:
    doc = _load_json(Path(OUTCOMES_WITH_REGIME_JSON), {})
    if isinstance(doc, list):
        return doc
    return doc.get("outcomes") or []


def enrich_outcomes_with_regime(outcomes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag PastCatalyst outcomes with the regime in force at their prediction date.

    Dates without a recorded regime are tagged ``UNKNOWN`` and excluded from
    per-regime calibration (rather than misattributed to the current regime).
    """
    tagged: list[dict[str, Any]] = []
    for o in outcomes:
        row = dict(o)
        if not row.get("regime"):
            pred_date = str(row.get("date") or "")[:10]
            row["regime"] = get_regime_at_date(pred_date) if pred_date else UNKNOWN_REGIME
        tagged.append(row)
    return tagged


def _outcome_key(o: dict[str, Any]) -> str:
    return f"{o.get('ticker')}|{str(o.get('date') or '')[:10]}|{o.get('node')}"


def resolve_regime_outcomes_for_learning(
    fallback_outcomes: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Merge persisted regime store with regime-tagged PastCatalyst outcomes.

    The previous logic *switched* sources once the store crossed the minimum
    sample size, which discontinuously collapsed the evaluation population from
    the full pool to a tiny, biased subset. We instead always union both sources
    (deduped); outcomes whose regime cannot be determined stay ``UNKNOWN`` and
    drop out of per-regime calibration on their own.
    """
    stored = load_outcomes_with_regime()
    if fallback_outcomes is None:
        from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources

        fallback_outcomes = collect_resolved_outcomes_from_sources()
    merged: dict[str, dict[str, Any]] = {}
    for o in enrich_outcomes_with_regime(fallback_outcomes):
        merged[_outcome_key(o)] = o
    for o in stored:
        merged[_outcome_key(o)] = o  # persisted (genuine) tags win
    return list(merged.values())


def append_outcome_with_regime(
    ticker: str,
    pred: float,
    actual: float,
    node: str,
    *,
    prediction_date: str | None = None,
    regime: MarketRegime | None = None,
) -> None:
    path = Path(OUTCOMES_WITH_REGIME_JSON)
    doc = _load_json(path, {"schema_version": 1, "outcomes": []})
    outcomes = doc.get("outcomes") if isinstance(doc, dict) else []
    if not isinstance(outcomes, list):
        outcomes = []
    pred_date = (prediction_date or _today_iso())[:10]
    entry = {
        "ticker": ticker.upper(),
        "pred": round(float(pred), 4),
        "actual": round(float(actual), 4),
        "node": node,
        "regime": regime or get_regime_at_date(pred_date) or UNKNOWN_REGIME,
        "date": pred_date,
        "recorded_at": _now_iso(),
    }
    outcomes.append(entry)
    _save_json(path, {"schema_version": 1, "updated_at": _now_iso(), "outcomes": outcomes[-5000:]})


def sync_outcomes_from_signal_audit() -> int:
    """Tag signal-calibration closed rows with regime; append new outcomes."""
    from orchestrator_io_paths import DATA_DIR

    sig = _load_json(Path(DATA_DIR) / "signal_calibration.json", {})
    existing_keys = {
        f"{o.get('ticker')}|{o.get('date')}|{o.get('node')}"
        for o in load_outcomes_with_regime()
    }
    added = 0
    for row in sig.get("scatter_pred5_vs_actual") or []:
        tk = str(row.get("ticker") or "").upper()
        pred = row.get("pred5_pp")
        actual = row.get("actual_5d_pct")
        if not tk or pred is None or actual is None:
            continue
        dk = str(row.get("log_date") or row.get("ts", ""))[:10]
        key = f"{tk}|{dk}|T+5"
        if key in existing_keys:
            continue
        append_outcome_with_regime(
            tk,
            float(pred),
            float(actual),
            "T+5",
            prediction_date=dk,
        )
        existing_keys.add(key)
        added += 1
    return added


def _pairs_mae(pairs: list[tuple[float, float]], m: float) -> float:
    return sum(abs(p * m - a) for p, a in pairs) / len(pairs)


def _solve_regime_multiplier(
    pairs: list[tuple[float, float]],
    mae_baseline: float,
    dir_acc: float,
) -> tuple[float, str]:
    """Magnitude-scaling factor that minimises in-sample error, regularised.

    The raw least-squares scalar ``sum(pred*actual)/sum(pred^2)`` overfits the
    magnitude ratio: predictions are timid while actuals are volatile (binary
    readouts), so even a tiny mean bias drives the scalar hard against a clip and
    the multiplier ends pinned to the 0.7/1.3 rails instead of settling near 1.0.
    Guards:
      * direction accuracy < threshold -> directionally unreliable, hold at 1.0;
      * tail actuals (|actual| > cap) are dropped from the regression so a few
        unpredictable jumps cannot dominate the ratio;
      * the OLS estimate is shrunk toward 1.0 with a ridge prior centred at 1.0
        (``m = (m_ols + k) / (1 + k)``) so it reflects the modest real bias
        rather than chasing volatility;
      * the shrunk, clipped factor is applied only if it cuts in-sample MAE by a
        material margin; otherwise hold at 1.0.
    """
    if dir_acc < REGIME_MIN_DIRECTION_ACC:
        return 1.0, "direction_unreliable"
    fit = [(p, a) for p, a in pairs if abs(a) <= REGIME_OUTLIER_ACTUAL_PP]
    den = sum(p * p for p, _ in fit)
    if den <= 1e-9:
        return 1.0, "no_improvement"
    m_ols = sum(p * a for p, a in fit) / den
    m = (m_ols + REGIME_SHRINK_PRIOR) / (1.0 + REGIME_SHRINK_PRIOR)
    m = max(REGIME_MULT_FLOOR, min(REGIME_MULT_CEILING, m))
    if abs(m - 1.0) < 1e-3:
        return 1.0, "no_improvement"
    if _pairs_mae(pairs, m) > mae_baseline * (1.0 - REGIME_MIN_REL_IMPROVEMENT) - 1e-9:
        return 1.0, "no_improvement"
    return m, "active"


def _load_learning_weeks() -> list[dict[str, Any]]:
    doc = _load_json(Path(LEARNING_HISTORY_JSON), {})
    weeks = doc.get("weeks") if isinstance(doc, dict) else None
    return weeks if isinstance(weeks, list) else []


def _circuit_breaker_for_regime(regime: str, proposed: float):
    """Guard a regime multiplier update against sustained divergence-while-degrading.

    Uses the same general breaker applied to every calibration layer; the
    per-regime value trail and the regime layer's after/baseline MAE come from
    the weekly learning history.
    """
    weeks = _load_learning_weeks()
    prev_values: list[float] = []
    mae_after: list[float | None] = []
    mae_baseline: list[float | None] = []
    for w in weeks:
        rm = w.get("regime_multipliers") if isinstance(w, dict) else None
        if not isinstance(rm, dict) or regime not in rm:
            continue
        try:
            prev_values.append(float(rm[regime]))
        except (TypeError, ValueError):
            continue
        mae_after.append(w.get("mae_after_regime"))
        mae_baseline.append(w.get("mae_baseline"))
    return evaluate_circuit_breaker(
        key=f"regime:{regime}",
        proposed_value=proposed,
        prev_values=prev_values,
        mae_after=mae_after,
        mae_baseline=mae_baseline,
    )


def compute_regime_multipliers(
    outcomes: list[dict[str, Any]] | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    if outcomes is None:
        outcomes = resolve_regime_outcomes_for_learning()

    multipliers: dict[str, Any] = {}
    for regime in ACTIVE_REGIMES:
        regime_outcomes = [o for o in outcomes if str(o.get("regime", "")).upper() == regime]
        if len(regime_outcomes) < REGIME_MIN_SAMPLES:
            multipliers[regime] = {
                "multiplier": 1.0,
                "status": "insufficient_data",
                "n": len(regime_outcomes),
                "bias_pp": None,
                "mae": None,
                "direction_acc": None,
            }
            continue

        pairs = [
            (float(o["pred"]), float(o["actual"]))
            for o in regime_outcomes
            if o.get("pred") is not None and o.get("actual") is not None
        ]
        bias = sum(p - a for p, a in pairs) / len(pairs)
        mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
        dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)

        multiplier, status = _solve_regime_multiplier(pairs, mae, dir_acc)
        entry = {
            "multiplier": round(multiplier, 3),
            "bias_pp": round(bias, 2),
            "mae": round(mae, 2),
            "direction_acc": round(dir_acc, 3),
            "n": len(regime_outcomes),
            "status": status,
            "last_updated": _today_iso(),
        }
        cb = _circuit_breaker_for_regime(regime, multiplier)
        if cb.triggered:
            entry["multiplier"] = round(cb.value, 3)
            entry["status"] = "frozen_circuit_breaker"
            entry["circuit_breaker"] = cb.detail
        multipliers[regime] = entry

    doc = {
        "schema_version": 1,
        "generated_at": _now_iso(),
        "current_regime": get_current_regime(),
        "min_samples": REGIME_MIN_SAMPLES,
        "regimes": multipliers,
    }
    if not dry_run:
        _save_json(Path(REGIME_MULTIPLIERS_JSON), doc)
        invalidate_regime_multiplier_cache()
    return doc


def apply_regime_multiplier(pred_pct: float, current_regime: MarketRegime | None = None) -> float:
    if pred_pct != pred_pct:
        return pred_pct
    regime = current_regime or get_current_regime()
    if regime == "CRISIS":
        regime = "RISK_OFF"
    factors = load_regime_multipliers()
    entry = factors.get(regime) if isinstance(factors, dict) else None
    if not isinstance(entry, dict):
        return pred_pct
    if entry.get("status") == "insufficient_data":
        return pred_pct
    mult = entry.get("multiplier")
    if mult is None:
        return pred_pct
    try:
        m = float(mult)
    except (TypeError, ValueError):
        return pred_pct
    if abs(m - 1.0) < 1e-6:
        return pred_pct
    return round(pred_pct * m, 4)
