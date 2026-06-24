"""
Cluster-specific cal_factor — phase × therapeutic area cohorts.

Blend: 60% cluster / 40% global (configurable via CLUSTER_GLOBAL_BLEND).
Minimum 5 resolved outcomes per cluster before activating.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import (
    CLUSTER_CAL_FACTORS_JSON,
    DATA_DIR,
    LEARNING_HISTORY_JSON,
    PAST_CATALYST_PREDICTIONS_JSON,
)
from prediction.calibration_circuit_breaker import evaluate_circuit_breaker

logger = logging.getLogger(__name__)

CLUSTER_MIN_SAMPLES = 5
CLUSTER_CF_FLOOR = 0.7
CLUSTER_CF_CEILING = 1.3
# Below this in-sample direction accuracy a cohort carries no directional signal,
# so scaling its predictions only amplifies noise -> hold the cal_factor at 1.0.
CLUSTER_MIN_DIRECTION_ACC = 0.5
# Ridge prior centred at 1.0. The raw least-squares scalar overfits the
# *magnitude ratio* (timid predictions vs volatile biotech actuals) and pins
# every cohort to a 0.7/1.3 rail even when the mean bias is tiny. Shrinking the
# OLS estimate toward 1.0 (m = (m_ols + k) / (1 + k)) makes the factor track the
# modest real bias instead of chasing volatility. Higher k = stronger shrink.
CLUSTER_SHRINK_PRIOR = 2.0
# Require at least this fractional in-sample MAE reduction before moving off 1.0.
CLUSTER_MIN_REL_IMPROVEMENT = 0.01
# Unpredictable tail moves (binary readouts) above this |actual| pp are dropped
# from the magnitude regression so a few jumps cannot dominate the scalar.
CLUSTER_OUTLIER_ACTUAL_PP = 50.0
CLUSTER_GLOBAL_BLEND = 0.6  # 60% cluster, 40% global — raise to 0.8 only when n >= 15

Direction = Literal["too_optimistic", "too_pessimistic", "calibrated"]
Status = Literal["active", "insufficient_data", "collecting_data"]

TICKER_CLUSTERS: dict[str, dict[str, list[str]]] = {
    "phase2_oncology": {
        "phase": ["Phase 2", "Phase 2a", "Phase 2b"],
        "area": ["oncology", "cancer", "tumor", "carcinoma", "lymphoma", "melanoma"],
    },
    "phase3_oncology": {
        "phase": ["Phase 3", "Phase 3 pivotal"],
        "area": ["oncology", "cancer", "tumor", "carcinoma"],
    },
    "phase2_rare": {
        "phase": ["Phase 2", "Phase 2a", "Phase 2b"],
        "area": ["rare", "orphan", "genetic"],
    },
    "phase3_rare": {
        "phase": ["Phase 3", "Phase 3 pivotal"],
        "area": ["rare", "orphan", "genetic"],
    },
    "phase3_metabolic": {
        "phase": ["Phase 3", "Phase 3 pivotal"],
        "area": ["nash", "metabolic", "obesity", "diabetes", "nafld"],
    },
    "phase2_immuno": {
        "phase": ["Phase 2", "Phase 2a", "Phase 2b"],
        "area": ["immunology", "rheumatoid", "lupus", "psoriasis", "autoimmune"],
    },
    "phase3_immuno": {
        "phase": ["Phase 3", "Phase 3 pivotal"],
        "area": ["immunology", "rheumatoid", "lupus", "psoriasis"],
    },
    "pdufa_regulatory": {
        "phase": ["NDA", "BLA", "PDUFA"],
        "area": [],
    },
    "phase1_2_early": {
        "phase": ["Phase 1", "Phase 1b", "Phase 1/2", "Phase 1b/Phase 2"],
        "area": [],
    },
}


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
    if path.name == Path(CLUSTER_CAL_FACTORS_JSON).name:
        invalidate_cluster_cal_factor_cache()


_cluster_doc_cache: tuple[float, dict[str, Any]] | None = None
_global_cal_cache: tuple[float, float] | None = None


def invalidate_cluster_cal_factor_cache() -> None:
    global _cluster_doc_cache, _global_cal_cache
    _cluster_doc_cache = None
    _global_cal_cache = None


def _cluster_json_mtime() -> float:
    path = Path(CLUSTER_CAL_FACTORS_JSON)
    try:
        return path.stat().st_mtime if path.is_file() else 0.0
    except OSError:
        return 0.0


def load_cluster_cal_factors() -> dict[str, Any]:
    global _cluster_doc_cache
    mtime = _cluster_json_mtime()
    if _cluster_doc_cache is not None and _cluster_doc_cache[0] == mtime:
        return _cluster_doc_cache[1]
    doc = _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {})
    factors = doc.get("clusters") if isinstance(doc, dict) and "clusters" in doc else doc
    if not isinstance(factors, dict):
        factors = {}
    _cluster_doc_cache = (mtime, factors)
    return factors


def ticker_metadata_from_row(row: dict[str, Any] | None) -> dict[str, str]:
    if not row:
        return {"phase": "", "condition": ""}
    phase = ""
    for key in ("Studio Phase", "Phase", "Clinical Phase", "phase", "Trial Phase"):
        v = row.get(key)
        if v is not None and str(v).strip():
            phase = str(v).strip()
            break
    condition = ""
    for key in ("Indication", "Condition", "condition", "Therapeutic Area", "Disease"):
        v = row.get(key)
        if v is not None and str(v).strip():
            condition = str(v).strip()
            break
    return {"phase": phase, "condition": condition}


def normalize_phase_text(phase_raw: str) -> str:
    """Normalize CT.gov / past_pred phase strings for cluster rules (PHASE2 → phase 2)."""
    s = str(phase_raw or "").strip().lower()
    if not s:
        return ""
    s = s.replace("|", " ").replace("/", " ").replace("-", " ").replace("_", " ")
    s = re.sub(r"phase\s*(\d)", r"phase \1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def classify_ticker(ticker_data: dict[str, Any] | None) -> str:
    phase = normalize_phase_text(str((ticker_data or {}).get("phase", "")))
    condition = str((ticker_data or {}).get("condition", "")).lower().strip()
    phase_only = not condition

    for cluster_name, rules in TICKER_CLUSTERS.items():
        phase_match = any(p.lower() in phase for p in rules["phase"])
        if not phase_match:
            continue
        area_rules = rules["area"]
        area_match = phase_only or not area_rules or any(a in condition for a in area_rules)
        if area_match:
            return cluster_name
    return "other"


def get_current_cluster_cal_factor(cluster: str) -> float:
    factors = load_cluster_cal_factors()
    entry = factors.get(cluster) if isinstance(factors, dict) else None
    if not isinstance(entry, dict):
        return 1.0
    cf = entry.get("cal_factor")
    if cf is None:
        return 1.0
    try:
        return float(cf)
    except (TypeError, ValueError):
        return 1.0


def get_global_cal_factor() -> float:
    global _global_cal_cache
    from orchestrator_io_paths import DATA_DIR

    path = Path(DATA_DIR) / "model_calibration_state.json"
    try:
        mtime = path.stat().st_mtime if path.is_file() else 0.0
    except OSError:
        mtime = 0.0
    if _global_cal_cache is not None and _global_cal_cache[0] == mtime:
        return _global_cal_cache[1]

    doc = _load_json(path, {})
    cur = doc.get("current") if isinstance(doc, dict) else {}
    cf = (cur or {}).get("cal_factor") if isinstance(cur, dict) else {}
    if isinstance(cf, dict):
        v = cf.get("v4_options") or cf.get("v4")
        try:
            val = float(v) if v is not None else 1.0
        except (TypeError, ValueError):
            val = 1.0
    else:
        try:
            val = float(cf) if cf is not None else 1.0
        except (TypeError, ValueError):
            val = 1.0
    _global_cal_cache = (mtime, val)
    return val


def blended_cluster_cal_factor(cluster: str, global_cal: float | None = None) -> float:
    """60/40 cluster/global blend when cluster has enough data."""
    factors = load_cluster_cal_factors()
    entry = factors.get(cluster) if isinstance(factors, dict) else None
    if not isinstance(entry, dict) or entry.get("cal_factor") is None:
        return 1.0
    if entry.get("status") == "insufficient_data":
        return 1.0
    n = int(entry.get("n_samples") or 0)
    if n < CLUSTER_MIN_SAMPLES:
        return 1.0
    cluster_cf = float(entry["cal_factor"])
    g = global_cal if global_cal is not None else get_global_cal_factor()
    blend = CLUSTER_GLOBAL_BLEND
    if n >= 15:
        blend = min(0.8, blend + 0.2 * ((n - 15) / 35))
    return round(cluster_cf * blend + g * (1.0 - blend), 4)


def build_cluster_blend_map(global_cal: float | None = None) -> dict[str, float]:
    """Precompute blended cluster cal_factor per cohort (batch metrics)."""
    g = global_cal if global_cal is not None else get_global_cal_factor()
    names = list(TICKER_CLUSTERS.keys()) + ["other"]
    return {name: blended_cluster_cal_factor(name, g) for name in names}


def apply_cluster_cal_factor(pred_pct: float, ticker_data: dict[str, Any] | None) -> float:
    if pred_pct != pred_pct:
        return pred_pct
    cluster = classify_ticker(ticker_data)
    blended = blended_cluster_cal_factor(cluster)
    if abs(blended - 1.0) < 1e-6:
        return pred_pct
    return round(pred_pct * blended, 4)


def _pairs_mae(pairs: list[tuple[float, float]], factor: float) -> float:
    return sum(abs(factor * p - a) for p, a in pairs) / len(pairs)


def _solve_cluster_cal_factor(
    pairs: list[tuple[float, float]],
    mae_baseline: float,
    dir_acc: float,
) -> tuple[float, str]:
    """Magnitude-scaling cal_factor minimising in-sample error, regularised.

    The raw least-squares scalar ``sum(pred*actual)/sum(pred^2)`` overfits the
    *magnitude ratio*: biotech predictions are timid while actuals are volatile
    (binary readouts), so even a tiny mean bias drives the scalar hard against a
    clip and every cohort ends pinned to the 0.7/1.3 rails instead of settling
    near 1.0. Guards:
      * direction accuracy < threshold -> directionally unreliable, hold at 1.0;
      * tail actuals (|actual| > cap) are dropped from the regression so a few
        unpredictable jumps cannot dominate the ratio;
      * the OLS estimate is shrunk toward 1.0 with a ridge prior centred at 1.0
        (``m = (m_ols + k) / (1 + k)``) so the factor reflects the modest real
        bias rather than chasing volatility;
      * the shrunk, clipped factor is applied only if it cuts in-sample MAE by a
        material margin; otherwise hold at 1.0.
    """
    if dir_acc < CLUSTER_MIN_DIRECTION_ACC:
        return 1.0, "direction_unreliable"
    fit = [(p, a) for p, a in pairs if abs(a) <= CLUSTER_OUTLIER_ACTUAL_PP]
    den = sum(p * p for p, _ in fit)
    if den <= 1e-9:
        return 1.0, "no_improvement"
    m_ols = sum(p * a for p, a in fit) / den
    m = (m_ols + CLUSTER_SHRINK_PRIOR) / (1.0 + CLUSTER_SHRINK_PRIOR)
    m = max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, m))
    if abs(m - 1.0) < 1e-3:
        return 1.0, "no_improvement"
    if _pairs_mae(pairs, m) > mae_baseline * (1.0 - CLUSTER_MIN_REL_IMPROVEMENT) - 1e-9:
        return 1.0, "no_improvement"
    return m, "active"


def _direction_from_bias(bias: float) -> Direction:
    if bias > 0.5:
        return "too_optimistic"
    if bias < -0.5:
        return "too_pessimistic"
    return "calibrated"


def _circuit_breaker_for_cluster(cluster: str, proposed: float):
    """Guard a cluster cal_factor update with the same general breaker as regimes.

    The per-cluster value trail and the cluster layer's after/baseline MAE come
    from the weekly learning history.
    """
    doc = _load_json(Path(LEARNING_HISTORY_JSON), {})
    weeks = doc.get("weeks") if isinstance(doc, dict) else None
    weeks = weeks if isinstance(weeks, list) else []
    prev_values: list[float] = []
    mae_after: list[float | None] = []
    mae_baseline: list[float | None] = []
    for w in weeks:
        cc = w.get("cluster_cal_factors") if isinstance(w, dict) else None
        if not isinstance(cc, dict) or cluster not in cc:
            continue
        try:
            prev_values.append(float(cc[cluster]))
        except (TypeError, ValueError):
            continue
        mae_after.append(w.get("mae_after_cluster"))
        mae_baseline.append(w.get("mae_baseline"))
    return evaluate_circuit_breaker(
        key=f"cluster:{cluster}",
        proposed_value=proposed,
        prev_values=prev_values,
        mae_after=mae_after,
        mae_baseline=mae_baseline,
    )


def compute_cluster_cal_factors(
    resolved_outcomes: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    cluster_errors: dict[str, list[dict[str, Any]]] = {}
    for outcome in resolved_outcomes:
        td = outcome.get("ticker_data") or {
            "phase": outcome.get("phase", ""),
            "condition": outcome.get("condition", ""),
        }
        cluster = classify_ticker(td)
        cluster_errors.setdefault(cluster, []).append(outcome)

    existing = load_cluster_cal_factors()
    cluster_cal_factors: dict[str, Any] = {}

    for cluster_name in list(TICKER_CLUSTERS.keys()) + ["other"]:
        errors = cluster_errors.get(cluster_name, [])
        prev = existing.get(cluster_name) if isinstance(existing, dict) else {}

        if len(errors) < CLUSTER_MIN_SAMPLES:
            cluster_cal_factors[cluster_name] = {
                "cal_factor": None,
                "status": "insufficient_data",
                "n_samples": len(errors),
                "bias_pp": None,
                "mae": None,
                "direction": "calibrated",
                "last_updated": prev.get("last_updated") if isinstance(prev, dict) else None,
                "recent_outcomes": errors[-10:],
            }
            continue

        pairs = [
            (float(e["pred"]), float(e["actual"]))
            for e in errors
            if e.get("pred") is not None and e.get("actual") is not None
        ]
        if not pairs:
            continue

        bias = sum(p - a for p, a in pairs) / len(pairs)
        mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
        dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)
        new_cal, status = _solve_cluster_cal_factor(pairs, mae, dir_acc)

        cb = _circuit_breaker_for_cluster(cluster_name, new_cal)
        if cb.triggered:
            new_cal = cb.value
            status = "frozen_circuit_breaker"

        cluster_cal_factors[cluster_name] = {
            "cal_factor": round(new_cal, 3),
            "bias_pp": round(bias, 2),
            "mae": round(mae, 2),
            "n_samples": len(errors),
            "direction_acc": round(dir_acc, 3),
            "direction": _direction_from_bias(bias),
            "status": status,
            **({"circuit_breaker": cb.detail} if cb.triggered else {}),
            "last_updated": _today_iso(),
            "recent_outcomes": [
                {
                    "ticker": e.get("ticker"),
                    "date": e.get("date"),
                    "pred": e.get("pred"),
                    "actual": e.get("actual"),
                    "node": e.get("node"),
                    "error_pp": round(float(e["pred"]) - float(e["actual"]), 2)
                    if e.get("pred") is not None and e.get("actual") is not None
                    else None,
                }
                for e in errors[-10:]
            ],
        }

    doc = {
        "schema_version": 1,
        "generated_at": _now_iso(),
        "cluster_global_blend": CLUSTER_GLOBAL_BLEND,
        "min_samples": CLUSTER_MIN_SAMPLES,
        "clusters": cluster_cal_factors,
    }
    if not dry_run:
        _save_json(Path(CLUSTER_CAL_FACTORS_JSON), doc)
    return doc


def collect_resolved_outcomes_from_sources() -> list[dict[str, Any]]:
    """Build outcome list from signal calibration scatter + past_pred nodes."""
    outcomes: list[dict[str, Any]] = []
    sig_path = Path(DATA_DIR) / "signal_calibration.json"
    sig = _load_json(sig_path, {})
    for row in sig.get("scatter_pred5_vs_actual") or []:
        if row.get("pred5_pp") is None or row.get("actual_5d_pct") is None:
            continue
        outcomes.append(
            {
                "ticker": row.get("ticker"),
                "pred": float(row["pred5_pp"]),
                "actual": float(row["actual_5d_pct"]),
                "node": "T+5",
                "date": str(row.get("log_date") or row.get("ts", ""))[:10],
                "ticker_data": {
                    "phase": row.get("phase", ""),
                    "condition": row.get("condition", ""),
                },
            }
        )

    from past_pred_io import load_past_pred_map

    def _pair(rec: dict[str, Any], pred_k: str, actual_k: str) -> tuple[float, float] | None:
        pred = rec.get(pred_k)
        actual = rec.get(actual_k)
        if pred is None or actual is None:
            return None
        try:
            return float(pred), float(actual)
        except (TypeError, ValueError):
            return None

    for tk, rec in (load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON) or {}).items():
        if not rec.get("model_accuracy_metrics_eligible"):
            continue
        phase = rec.get("phase") or rec.get("trial_phase") or ""
        condition = rec.get("indication") or rec.get("condition") or ""
        cd_date = str(rec.get("completion_date", ""))[:10]
        ticker_data = {"phase": str(phase), "condition": str(condition)}
        for node, pred_keys, actual_k in (
            ("T-10", ("model_dm10_pct", "model_d10_pct"), "d10_pct"),
            ("T-5", ("model_dm5_pct", "model_d5_pct"), "d5_pct"),
            ("T-3", ("model_dm3_pct", "model_d3_pct"), "d3_pct"),
        ):
            pair: tuple[float, float] | None = None
            for pred_k in pred_keys:
                pair = _pair(rec, pred_k, actual_k)
                if pair is not None:
                    break
            if pair is None:
                continue
            outcomes.append(
                {
                    "ticker": tk,
                    "pred": pair[0],
                    "actual": pair[1],
                    "node": node,
                    "date": cd_date,
                    "ticker_data": ticker_data,
                }
            )
    return outcomes
