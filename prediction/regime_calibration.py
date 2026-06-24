"""
Regime multiplier — correct systematic over/undershoot by market regime.

Uses ``market_context_gate`` for RISK_ON / NEUTRAL / RISK_OFF / CRISIS.
Minimum 8 outcomes per regime before activating.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import (
    LEARNING_HISTORY_JSON,
    OUTCOMES_WITH_REGIME_JSON,
    REGIME_MULTIPLIERS_JSON,
)
from prediction.calibration_circuit_breaker import evaluate_circuit_breaker

logger = logging.getLogger(__name__)

REGIME_MIN_SAMPLES = 8
REGIME_MULT_FLOOR = 0.7
REGIME_MULT_CEILING = 1.3
ACTIVE_REGIMES = ("RISK_ON", "NEUTRAL", "RISK_OFF")
# Apply-side robustness (mirrors cluster_cal_factor): require more evidence
# before a correction is applied, shrink toward 1.0 by sample size, and skip
# bias that sits within measurement noise.
REGIME_MIN_APPLY_SAMPLES = 12
REGIME_SHRINK_K = 20.0
REGIME_BIAS_DEADBAND_PP = 1.0

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


def robust_regime_multiplier(regime: str) -> float:
    """Apply-side robust regime multiplier: require evidence, shrink to 1.0 by
    sample size, skip noise-level bias, clamp. Mirrors the cluster cal_factor
    apply-side guards so a regime with thin/noisy evidence stays neutral.
    """
    factors = load_regime_multipliers()
    entry = factors.get(regime) if isinstance(factors, dict) else None
    if not isinstance(entry, dict) or entry.get("multiplier") is None:
        return 1.0
    if entry.get("status") == "insufficient_data":
        return 1.0
    n = int(entry.get("n") or 0)
    if n < REGIME_MIN_APPLY_SAMPLES:
        return 1.0
    # Don't apply a correction when the measured bias is within measurement noise.
    bias_pp = entry.get("bias_pp")
    if bias_pp is not None:
        try:
            if abs(float(bias_pp)) < REGIME_BIAS_DEADBAND_PP:
                return 1.0
        except (TypeError, ValueError):
            pass
    try:
        mult = float(entry["multiplier"])
    except (TypeError, ValueError):
        return 1.0
    # Shrink the multiplier toward 1.0 by sample size (few obs -> near-neutral).
    shrink_w = n / (n + REGIME_SHRINK_K)
    mult = 1.0 + (mult - 1.0) * shrink_w
    mult = max(REGIME_MULT_FLOOR, min(REGIME_MULT_CEILING, mult))
    return round(mult, 4)


def build_regime_multiplier_map() -> dict[str, float]:
    return {regime: robust_regime_multiplier(regime) for regime in ACTIVE_REGIMES}


def _circuit_breaker_for_regime(regime: str, proposed: float):
    """Guard a regime multiplier update with the general breaker.

    The per-regime value trail and the regime layer's after/baseline MAE come
    from the weekly learning history.
    """
    doc = _load_json(Path(LEARNING_HISTORY_JSON), {})
    weeks = doc.get("weeks") if isinstance(doc, dict) else None
    weeks = weeks if isinstance(weeks, list) else []
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


def get_current_regime() -> MarketRegime:
    from prediction.market_context_gate import load_market_context

    doc = load_market_context()
    regime = str(doc.get("regime") or "NEUTRAL").upper()
    if regime in ("RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"):
        return regime  # type: ignore[return-value]
    return "NEUTRAL"


def get_regime_at_date(iso_date: str) -> MarketRegime:
    """Best-effort: use current regime if historical series unavailable."""
    _ = iso_date
    return get_current_regime()


def load_outcomes_with_regime() -> list[dict[str, Any]]:
    doc = _load_json(Path(OUTCOMES_WITH_REGIME_JSON), {})
    if isinstance(doc, list):
        return doc
    return doc.get("outcomes") or []


def enrich_outcomes_with_regime(outcomes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tag main PastCatalyst outcomes with best-effort regime when the regime store is sparse."""
    tagged: list[dict[str, Any]] = []
    for o in outcomes:
        row = dict(o)
        if not row.get("regime"):
            pred_date = str(row.get("date") or "")[:10]
            row["regime"] = get_regime_at_date(pred_date) if pred_date else get_current_regime()
        tagged.append(row)
    return tagged


def resolve_regime_outcomes_for_learning(
    fallback_outcomes: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Prefer persisted regime store; backfill from PastCatalyst pool when too small."""
    stored = load_outcomes_with_regime()
    if len(stored) >= REGIME_MIN_SAMPLES:
        return stored
    if fallback_outcomes is None:
        from prediction.cluster_cal_factor import collect_resolved_outcomes_from_sources

        fallback_outcomes = collect_resolved_outcomes_from_sources()
    return enrich_outcomes_with_regime(fallback_outcomes)


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
        "regime": regime or get_regime_at_date(pred_date),
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
        multiplier = max(REGIME_MULT_FLOOR, min(REGIME_MULT_CEILING, 1.0 - bias / 12.0))
        status = "active"
        cb = _circuit_breaker_for_regime(regime, multiplier)
        if cb.triggered:
            multiplier = cb.value
            status = "frozen_circuit_breaker"

        multipliers[regime] = {
            "multiplier": round(multiplier, 3),
            "bias_pp": round(bias, 2),
            "mae": round(mae, 2),
            "direction_acc": round(dir_acc, 3),
            "n": len(regime_outcomes),
            "status": status,
            **({"circuit_breaker": cb.detail} if cb.triggered else {}),
            "last_updated": _today_iso(),
        }

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
    m = robust_regime_multiplier(regime)
    if abs(m - 1.0) < 1e-6:
        return pred_pct
    return round(pred_pct * m, 4)
