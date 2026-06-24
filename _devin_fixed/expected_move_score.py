"""Expected Move Score (EMS) — pre-event magnitude / volatility signal.

The model's *directional* forecast for a binary clinical readout is ~random (the
readout outcome is exogenous to price history). But the *size* of the model's
pre/post-CD curve carries a weak-but-robust signal for the *magnitude* of the
realized move. EMS ranks how big a move to expect around the catalyst — for
position sizing and straddle/volatility screening. It says NOTHING about
direction.

Predictor::

    expected_move_predictor = mean(|model_dm5_pct|, |model_d3_pct|, |model_d5_pct|)

Validated on 1,851 resolved catalysts (temporal out-of-sample split):

    corr(predictor, |realized 5d move|) ~ 0.15
    quintile lift: Q1 median |move| ~2.2pp  ->  Q5 ~6.2pp  (~2.9x)
    P(|move| > 10pp): Q1 ~10%  ->  Q4-Q5 ~21-24%

The score is calibrated against realized |move| with persisted quantile
thresholds, so the bucket labels and expected-move estimates reflect the user's
own resolved history rather than hard-coded numbers.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON

EXPECTED_MOVE_CALIBRATION_JSON = Path(DATA_DIR) / "expected_move_calibration.json"

# Pre-event magnitude inputs (all available as-of the prediction date).
PREDICTOR_KEYS: tuple[str, ...] = ("model_dm5_pct", "model_d3_pct", "model_d5_pct")
# Realized move whose magnitude EMS estimates.
TARGET_KEY = "d5_pct"

BUCKET_LABELS: tuple[str, ...] = (
    "Molto basso",
    "Basso",
    "Medio",
    "Alto",
    "Molto alto",
)
STRADDLE_MIN_BUCKET = 4  # buckets 4-5 (top 40%) flagged as straddle candidates
MIN_CALIBRATION_SAMPLES = 100
LARGE_MOVE_PP = 10.0  # threshold for the "big move" probability stat


def _float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def expected_move_predictor(rec: dict[str, Any]) -> float | None:
    """Mean absolute pre/post-CD curve magnitude — the EMS predictor.

    Returns ``None`` when none of the curve nodes are available.
    """
    vals = [abs(v) for v in (_float(rec.get(k)) for k in PREDICTOR_KEYS) if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def _quantile(sorted_vals: list[float], frac: float) -> float:
    """Linear-interpolated quantile of an already-sorted list."""
    if not sorted_vals:
        return 0.0
    if frac <= 0:
        return sorted_vals[0]
    if frac >= 1:
        return sorted_vals[-1]
    pos = frac * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _corr(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return cov / math.sqrt(vx * vy)


def collect_magnitude_samples(
    records: dict[str, Any] | None = None,
) -> list[tuple[float, float]]:
    """Build ``(predictor, |realized move|)`` pairs from resolved catalysts."""
    if records is None:
        from past_pred_io import load_past_pred_map

        records = load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON) or {}
    samples: list[tuple[float, float]] = []
    for rec in records.values():
        if not isinstance(rec, dict) or not rec.get("model_accuracy_metrics_eligible"):
            continue
        pred = expected_move_predictor(rec)
        actual = _float(rec.get(TARGET_KEY))
        if pred is None or actual is None:
            continue
        samples.append((pred, abs(actual)))
    return samples


def build_expected_move_calibration(
    samples: list[tuple[float, float]] | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Compute quantile thresholds + per-bucket realized stats and (optionally) persist."""
    if samples is None:
        samples = collect_magnitude_samples()
    n = len(samples)
    if n < MIN_CALIBRATION_SAMPLES:
        doc = {
            "schema_version": 1,
            "updated_at": _now_iso(),
            "status": "insufficient_data",
            "n_samples": n,
        }
        if not dry_run:
            _save_json(EXPECTED_MOVE_CALIBRATION_JSON, doc)
        return doc

    preds = sorted(p for p, _ in samples)
    # 21 quantile knots (every 5%) for percentile lookup.
    pred_quantiles = [_quantile(preds, i / 20.0) for i in range(21)]
    # Quintile edges from the predictor distribution.
    edges = [_quantile(preds, q) for q in (0.2, 0.4, 0.6, 0.8)]

    def bucket_of(p: float) -> int:
        for i, e in enumerate(edges):
            if p <= e:
                return i + 1
        return 5

    by_bucket: dict[int, list[float]] = {i: [] for i in range(1, 6)}
    for p, mv in samples:
        by_bucket[bucket_of(p)].append(mv)

    buckets: list[dict[str, Any]] = []
    for i in range(1, 6):
        moves = sorted(by_bucket[i])
        if moves:
            median = _quantile(moves, 0.5)
            mean = sum(moves) / len(moves)
            prob_big = sum(1 for m in moves if m > LARGE_MOVE_PP) / len(moves)
        else:
            median = mean = prob_big = 0.0
        buckets.append(
            {
                "bucket": i,
                "label": BUCKET_LABELS[i - 1],
                "n": len(moves),
                "pred_max": round(edges[i - 1], 4) if i <= 4 else None,
                "median_move_pp": round(median, 2),
                "mean_move_pp": round(mean, 2),
                "prob_gt_10pp": round(prob_big, 3),
                "straddle_candidate": i >= STRADDLE_MIN_BUCKET,
            }
        )

    corr = _corr([p for p, _ in samples], [mv for _, mv in samples])
    doc = {
        "schema_version": 1,
        "updated_at": _now_iso(),
        "status": "active",
        "n_samples": n,
        "predictor": "mean_abs(" + ",".join(PREDICTOR_KEYS) + ")",
        "target": f"abs({TARGET_KEY})",
        "overall_corr": round(corr, 4) if corr is not None else None,
        "large_move_pp": LARGE_MOVE_PP,
        "straddle_min_bucket": STRADDLE_MIN_BUCKET,
        "pred_quantiles": [round(q, 4) for q in pred_quantiles],
        "buckets": buckets,
    }
    if not dry_run:
        _save_json(EXPECTED_MOVE_CALIBRATION_JSON, doc)
    return doc


def load_expected_move_calibration() -> dict[str, Any]:
    return _load_json(EXPECTED_MOVE_CALIBRATION_JSON, {})


def _percentile_of(value: float, quantiles: list[float]) -> float:
    """Map a predictor value to a 0-100 percentile via the 5%-spaced knots."""
    if not quantiles:
        return 0.0
    if value <= quantiles[0]:
        return 0.0
    if value >= quantiles[-1]:
        return 100.0
    step = 100.0 / (len(quantiles) - 1)
    for i in range(1, len(quantiles)):
        if value <= quantiles[i]:
            lo, hi = quantiles[i - 1], quantiles[i]
            frac = 0.0 if hi == lo else (value - lo) / (hi - lo)
            return round((i - 1 + frac) * step, 1)
    return 100.0


def score_expected_move(
    rec_or_value: dict[str, Any] | float | None,
    calibration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Score the expected *magnitude* of the catalyst move (direction-agnostic).

    Accepts a prediction record or a raw predictor value. Returns the percentile
    score (0-100), the calibrated bucket/label, the expected realized move
    estimates for that bucket, and a straddle-candidate flag.
    """
    note = "Solo magnitudine: NON indica la direzione del movimento."
    if isinstance(rec_or_value, dict):
        predictor = expected_move_predictor(rec_or_value)
    else:
        predictor = _float(rec_or_value)
    if predictor is None:
        return {"status": "insufficient_data", "expected_move_score": None, "note": note}

    cal = calibration if calibration is not None else load_expected_move_calibration()
    if not cal or cal.get("status") != "active":
        return {
            "status": "uncalibrated",
            "expected_move_score": None,
            "predictor": round(predictor, 4),
            "note": note,
        }

    quantiles = cal.get("pred_quantiles") or []
    pct = _percentile_of(predictor, quantiles)
    buckets = cal.get("buckets") or []
    idx = min(int(pct // 20), 4)  # 0..4
    bucket = buckets[idx] if idx < len(buckets) else {}
    return {
        "status": "active",
        "expected_move_score": pct,
        "bucket": bucket.get("bucket", idx + 1),
        "label": bucket.get("label", BUCKET_LABELS[idx]),
        "expected_median_move_pp": bucket.get("median_move_pp"),
        "expected_mean_move_pp": bucket.get("mean_move_pp"),
        "prob_gt_10pp": bucket.get("prob_gt_10pp"),
        "straddle_candidate": bool(bucket.get("straddle_candidate", False)),
        "predictor": round(predictor, 4),
        "note": note,
    }
