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
    PAST_CATALYST_PREDICTIONS_JSON,
)

logger = logging.getLogger(__name__)

CLUSTER_MIN_SAMPLES = 5
CLUSTER_CF_FLOOR = 0.7
CLUSTER_CF_CEILING = 1.3
CLUSTER_GLOBAL_BLEND = 0.6  # 60% cluster, 40% global — raise to 0.8 only when n >= 15
CLUSTER_MIN_APPLY_SAMPLES = 12  # require more evidence before a correction is applied
CLUSTER_SHRINK_K = 20.0  # shrinkage strength: cluster factor pulled toward 1.0 when n is small
CLUSTER_BIAS_DEADBAND_PP = 1.0  # circuit-breaker: don't correct bias within measurement noise

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
    """Robust cluster/global blend: shrink to 1.0 by sample size, skip noise-level bias, clamp."""
    factors = load_cluster_cal_factors()
    entry = factors.get(cluster) if isinstance(factors, dict) else None
    if not isinstance(entry, dict) or entry.get("cal_factor") is None:
        return 1.0
    if entry.get("status") == "insufficient_data":
        return 1.0
    n = int(entry.get("n_samples") or 0)
    if n < CLUSTER_MIN_APPLY_SAMPLES:
        return 1.0
    # Circuit-breaker: don't apply a correction when the measured bias is within noise.
    bias_pp = entry.get("bias_pp")
    if bias_pp is not None:
        try:
            if abs(float(bias_pp)) < CLUSTER_BIAS_DEADBAND_PP:
                return 1.0
        except (TypeError, ValueError):
            pass
    cluster_cf = float(entry["cal_factor"])
    # Shrink the cluster factor toward 1.0 by sample size (few obs -> near-neutral).
    shrink_w = n / (n + CLUSTER_SHRINK_K)
    cluster_cf = 1.0 + (cluster_cf - 1.0) * shrink_w
    g = global_cal if global_cal is not None else get_global_cal_factor()
    blend = CLUSTER_GLOBAL_BLEND
    if n >= 15:
        blend = min(0.8, blend + 0.2 * ((n - 15) / 35))
    blended = cluster_cf * blend + g * (1.0 - blend)
    blended = max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, blended))
    return round(blended, 4)


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


def _direction_from_bias(bias: float) -> Direction:
    if bias > 0.5:
        return "too_optimistic"
    if bias < -0.5:
        return "too_pessimistic"
    return "calibrated"


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
        prev_cf = prev.get("cal_factor") if isinstance(prev, dict) else None
        current_cal = float(prev_cf) if prev_cf is not None else 1.0

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

        preds = [float(e["pred"]) for e in errors if e.get("pred") is not None]
        actuals = [float(e["actual"]) for e in errors if e.get("actual") is not None]
        pairs = [
            (float(e["pred"]), float(e["actual"]))
            for e in errors
            if e.get("pred") is not None and e.get("actual") is not None
        ]
        if not pairs:
            continue

        bias = sum(p - a for p, a in pairs) / len(pairs)
        mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
        new_cal = max(CLUSTER_CF_FLOOR, min(CLUSTER_CF_CEILING, current_cal * (1.0 - bias / 10.0)))

        cluster_cal_factors[cluster_name] = {
            "cal_factor": round(new_cal, 3),
            "bias_pp": round(bias, 2),
            "mae": round(mae, 2),
            "n_samples": len(errors),
            "direction": _direction_from_bias(bias),
            "status": "active",
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
