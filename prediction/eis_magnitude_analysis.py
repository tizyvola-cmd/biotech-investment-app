"""
EIS magnitude analysis — high vs low/negative EIS scores and price correlation.

Only feed events / opportunities **with** a scored EIS (|score| > 0).
Measures market reaction (ΔP) and temporal radius before CD where EIS aligns with price.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR
from prediction.eis_feed_quality import filter_verified_feed_events, is_valid_feed_ticker

_CLINICAL_SNAPSHOT = Path(DATA_DIR) / "clinical_pre_cd_enrichment_snapshot.json"
_EIS_MAGNITUDE_SNAPSHOT = Path(DATA_DIR) / "eis_magnitude_analysis.json"

EIS_ZERO_EPS = 1e-6
TEMPORAL_WINDOWS: tuple[tuple[int, int, str], ...] = (
    (0, 30, "0–30d"),
    (31, 60, "31–60d"),
    (61, 90, "61–90d"),
    (91, 180, "91–180d"),
    (181, 9999, "180d+"),
)


def _parse_day(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = min(len(xs), len(ys))
    if n < 3:
        return None
    mx = sum(xs[:n]) / n
    my = sum(ys[:n]) / n
    num = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den_x = math.sqrt(sum((xs[i] - mx) ** 2 for i in range(n)))
    den_y = math.sqrt(sum((ys[i] - my) ** 2 for i in range(n)))
    if den_x < 1e-12 or den_y < 1e-12:
        return None
    return round(num / (den_x * den_y), 4)


def _spearman(xs: list[float], ys: list[float]) -> float | None:
    n = min(len(xs), len(ys))
    if n < 3:
        return None

    def _ranks(vals: list[float]) -> list[float]:
        order = sorted(range(n), key=lambda i: vals[i])
        ranks = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vals[order[j + 1]] == vals[order[i]]:
                j += 1
            avg_rank = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                ranks[order[k]] = avg_rank
            i = j + 1
        return ranks

    return _pearson(_ranks(xs[:n]), _ranks(ys[:n]))


def _linear_regression(xs: list[float], ys: list[float]) -> dict[str, Any]:
    """OLS: y = intercept + slope * x (EIS score vs ΔP pp)."""
    n = len(xs)
    if n < 3:
        return {"n": n, "slope": None, "intercept": None, "r": None, "line": []}
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    if sxx < 1e-12:
        return {"n": n, "slope": None, "intercept": None, "r": _pearson(xs, ys), "line": []}
    slope = sxy / sxx
    intercept = my - slope * mx
    x_min, x_max = min(xs), max(xs)
    pad = (x_max - x_min) * 0.05 if x_max > x_min else 0.5
    x0, x1 = x_min - pad, x_max + pad
    line = [
        {"x": round(x0, 4), "y": round(intercept + slope * x0, 3)},
        {"x": round(x1, 4), "y": round(intercept + slope * x1, 3)},
    ]
    return {
        "n": n,
        "slope": round(slope, 4),
        "intercept": round(intercept, 4),
        "r": _pearson(xs, ys),
        "line": line,
    }


def _scatter_regression_payload(
    rows: list[dict[str, Any]],
    *,
    price_key: str,
    max_points: int = 120,
) -> dict[str, Any]:
    pts: list[dict[str, Any]] = []
    xs: list[float] = []
    ys: list[float] = []
    for r in rows:
        x = _float(r.get("eis_score"))
        y = _float(r.get(price_key))
        if x is None or y is None:
            continue
        xs.append(x)
        ys.append(y)
        if len(pts) < max_points:
            pts.append(
                {
                    "x": round(x, 4),
                    "y": round(y, 3),
                    "window": r.get("temporal_window"),
                    "ticker": r.get("ticker"),
                }
            )
    reg = _linear_regression(xs, ys)
    return {"points": pts, "regression": reg, "n_total": len(xs)}


def _temporal_window_label(days_before_cd: int) -> str:
    for lo, hi, label in TEMPORAL_WINDOWS:
        if lo <= days_before_cd <= hi:
            return label
    return "—"


def _cohort_price_stats(rows: list[dict[str, Any]], *, price_key: str = "delta_p_3d") -> dict[str, Any]:
    vals = [_float(r.get(price_key)) for r in rows]
    vals = [v for v in vals if v is not None]
    if not vals:
        return {
            "n": len(rows),
            "n_with_price": 0,
            "avg_move_pp": None,
            "median_move_pp": None,
            "pct_positive": None,
        }
    pos = sum(1 for v in vals if v > 0)
    sorted_v = sorted(vals)
    mid = len(sorted_v) // 2
    median = (
        sorted_v[mid]
        if len(sorted_v) % 2
        else (sorted_v[mid - 1] + sorted_v[mid]) / 2.0
    )
    return {
        "n": len(rows),
        "n_with_price": len(vals),
        "avg_move_pp": round(sum(vals) / len(vals), 3),
        "median_move_pp": round(median, 3),
        "pct_positive": round(100.0 * pos / len(vals), 2),
    }


def _split_high_low(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], float | None]:
    scores = [_float(r.get("eis_score")) for r in rows]
    scored = [(r, s) for r, s in zip(rows, scores) if s is not None]
    if not scored:
        return [], [], None
    vals = sorted(s for _, s in scored)
    mid = len(vals) // 2
    threshold = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2.0
    low = [r for r, s in scored if s <= threshold]
    high = [r for r, s in scored if s > threshold]
    return low, high, round(threshold, 4)


def _iter_scored_feed_events(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rec in records:
        if not is_valid_feed_ticker(rec.get("ticker")):
            continue
        cd = _parse_day(rec.get("cd_date"))
        if not cd:
            continue
        ticker = str(rec.get("ticker") or "").upper()
        events = filter_verified_feed_events(rec.get("clinical_events") or rec.get("timeline_events") or [])
        for ev in events:
            if not isinstance(ev, dict):
                continue
            eis = ev.get("eis") if isinstance(ev.get("eis"), dict) else {}
            score = _float(eis.get("score"))
            if score is None or abs(score) <= EIS_ZERO_EPS:
                continue
            ed = _parse_day(ev.get("event_date"))
            if not ed or ed > cd:
                continue
            days_before_cd = (cd - ed).days
            price = ev.get("price") if isinstance(ev.get("price"), dict) else {}
            out.append(
                {
                    "ticker": ticker,
                    "cd_date": cd.isoformat(),
                    "event_date": ed.isoformat(),
                    "days_before_cd": days_before_cd,
                    "eis_score": score,
                    "delta_p_1d": _float(price.get("delta_p_1d")),
                    "delta_p_3d": _float(price.get("delta_p_3d")),
                    "delta_p_7d": _float(price.get("delta_p_7d")),
                    "temporal_window": _temporal_window_label(days_before_cd),
                    "source_type": ev.get("source_type"),
                }
            )
    return out


def _temporal_regression_rows(event_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per finestra pre-CD: pendenza OLS EIS→ΔP a T+1 e T+7 (~5 sedute)."""
    buckets: list[dict[str, Any]] = []
    for lo, hi, label in TEMPORAL_WINDOWS:
        subset = [r for r in event_rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        reg_1d = _scatter_regression_payload(subset, price_key="delta_p_1d", max_points=0)
        reg_7d = _scatter_regression_payload(subset, price_key="delta_p_7d", max_points=0)
        buckets.append(
            {
                "window": label,
                "days_min": lo,
                "days_max": hi if hi < 9999 else None,
                "n_events": len(subset),
                "regression_1d": reg_1d["regression"],
                "regression_7d": reg_7d["regression"],
                "n_with_price_1d": reg_1d["regression"].get("n") or 0,
                "n_with_price_7d": reg_7d["regression"].get("n") or 0,
            }
        )
    return buckets


def _temporal_radius_rows(event_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: list[dict[str, Any]] = []
    for lo, hi, label in TEMPORAL_WINDOWS:
        subset = [r for r in event_rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        low, high, thr = _split_high_low(subset)
        xs = [_float(r["eis_score"]) for r in subset if _float(r.get("delta_p_3d")) is not None]
        ys = [_float(r["delta_p_3d"]) for r in subset if _float(r.get("delta_p_3d")) is not None]
        low_stats = _cohort_price_stats(low, price_key="delta_p_3d")
        high_stats = _cohort_price_stats(high, price_key="delta_p_3d")
        avg_low = low_stats.get("avg_move_pp")
        avg_high = high_stats.get("avg_move_pp")
        lift = (
            round(float(avg_high) - float(avg_low), 3)
            if avg_high is not None and avg_low is not None
            else None
        )
        buckets.append(
            {
                "window": label,
                "days_min": lo,
                "days_max": hi if hi < 9999 else None,
                "n_events": len(subset),
                "n_with_price": len(xs),
                "split_threshold": thr,
                "low_eis": low_stats,
                "high_eis": high_stats,
                "high_minus_low_avg_pp": lift,
                "pearson_eis_vs_d3": _pearson(xs, ys),
                "spearman_eis_vs_d3": _spearman(xs, ys),
            }
        )
    return buckets


def _temporal_sign_split_rows(event_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per finestra pre-CD: ΔP medio T+1/T+7 per EIS negativo vs positivo."""
    buckets: list[dict[str, Any]] = []
    for lo, hi, label in TEMPORAL_WINDOWS:
        subset = [r for r in event_rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        neg = [r for r in subset if (_float(r.get("eis_score")) or 0) < 0]
        pos = [r for r in subset if (_float(r.get("eis_score")) or 0) > 0]
        neg_1d = _cohort_price_stats(neg, price_key="delta_p_1d")
        pos_1d = _cohort_price_stats(pos, price_key="delta_p_1d")
        neg_7d = _cohort_price_stats(neg, price_key="delta_p_7d")
        pos_7d = _cohort_price_stats(pos, price_key="delta_p_7d")
        avg_neg_1d = neg_1d.get("avg_move_pp")
        avg_pos_1d = pos_1d.get("avg_move_pp")
        avg_neg_7d = neg_7d.get("avg_move_pp")
        avg_pos_7d = pos_7d.get("avg_move_pp")
        buckets.append(
            {
                "window": label,
                "days_min": lo,
                "days_max": hi if hi < 9999 else None,
                "n_events": len(subset),
                "negative_eis_1d": neg_1d,
                "positive_eis_1d": pos_1d,
                "negative_eis_7d": neg_7d,
                "positive_eis_7d": pos_7d,
                "pos_minus_neg_avg_1d": (
                    round(float(avg_pos_1d) - float(avg_neg_1d), 3)
                    if avg_pos_1d is not None and avg_neg_1d is not None
                    else None
                ),
                "pos_minus_neg_avg_7d": (
                    round(float(avg_pos_7d) - float(avg_neg_7d), 3)
                    if avg_pos_7d is not None and avg_neg_7d is not None
                    else None
                ),
            }
        )
    return buckets


def _pick_peak_regression_window(buckets: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Finestra con maggiore |pendenza| OLS EIS→ΔP (pp per punto EIS)."""
    scored: list[dict[str, Any]] = []
    for b in buckets:
        for key in ("regression_1d", "regression_7d"):
            reg = b.get(key) or {}
            slope = reg.get("slope")
            n = reg.get("n") or 0
            if slope is not None and n >= 5:
                scored.append({**b, "_peak_metric": abs(float(slope)), "_peak_key": key})
    if not scored:
        for b in buckets:
            for key in ("regression_1d", "regression_7d"):
                reg = b.get(key) or {}
                slope = reg.get("slope")
                r = reg.get("r")
                n = reg.get("n") or 0
                if n >= 3 and slope is not None:
                    scored.append({**b, "_peak_metric": abs(float(slope)), "_peak_key": key})
                elif n >= 3 and r is not None:
                    scored.append({**b, "_peak_metric": abs(float(r)) * 5.0, "_peak_key": key})
    if not scored:
        return None
    best = max(scored, key=lambda x: float(x.get("_peak_metric") or 0))
    reg = best.get(best.get("_peak_key")) or {}
    return {
        "window": best.get("window"),
        "days_min": best.get("days_min"),
        "days_max": best.get("days_max"),
        "horizon": "1d" if best.get("_peak_key") == "regression_1d" else "7d",
        "pearson_r": reg.get("r"),
        "slope_pp_per_eis": reg.get("slope"),
    }


def _pick_peak_window(buckets: list[dict[str, Any]]) -> dict[str, Any] | None:
    scored = [
        b
        for b in buckets
        if b.get("n_with_price", 0) >= 5 and b.get("high_minus_low_avg_pp") is not None
    ]
    if not scored:
        scored = [b for b in buckets if b.get("n_with_price", 0) >= 3]
    if not scored:
        return None

    def _rank(b: dict[str, Any]) -> tuple[float, float]:
        lift = abs(float(b.get("high_minus_low_avg_pp") or 0))
        corr = abs(float(b.get("pearson_eis_vs_d3") or 0))
        return (lift + corr * 5.0, lift)

    return max(scored, key=_rank)


def _percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = (len(s) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return s[lo]
    w = idx - lo
    return s[lo] * (1 - w) + s[hi] * w


def _expected_pp(slope: float, intercept: float, eis: float) -> float:
    return intercept + slope * eis


def _build_expected_move_calibration(
    reg: dict[str, Any],
    eis_scores: list[float],
    *,
    horizon_key: str,
    horizon_label: str,
) -> dict[str, Any] | None:
    """Calibration curve: EIS score → expected ΔP (pp) from cohort OLS."""
    slope = reg.get("slope")
    intercept = reg.get("intercept")
    n = int(reg.get("n") or 0)
    if slope is None or intercept is None or n < 3:
        return None
    slope_f = float(slope)
    intercept_f = float(intercept)
    scores = [float(x) for x in eis_scores if x is not None and math.isfinite(float(x))]
    if len(scores) < 3:
        return None

    eis_min = round(min(scores), 2)
    eis_max = round(max(scores), 2)
    pad = max(1.0, (eis_max - eis_min) * 0.05)
    x0 = eis_min - pad
    x1 = eis_max + pad
    line_pts = 48
    line = [
        {
            "eis": round(x0 + (x1 - x0) * i / (line_pts - 1), 3),
            "expected_pp": round(_expected_pp(slope_f, intercept_f, x0 + (x1 - x0) * i / (line_pts - 1)), 3),
        }
        for i in range(line_pts)
    ]

    anchor_candidates = sorted(
        {
            round(x, 2)
            for x in (
                -20.0,
                -10.0,
                -5.0,
                -2.0,
                -1.0,
                0.0,
                1.0,
                2.0,
                5.0,
                10.0,
                20.0,
                _percentile(scores, 0.25),
                _percentile(scores, 0.50),
                _percentile(scores, 0.75),
            )
            if x0 <= x <= x1
        }
    )
    anchors = [
        {
            "eis": x,
            "expected_pp": round(_expected_pp(slope_f, intercept_f, x), 3),
            "label": "0" if abs(x) < 1e-9 else f"{x:+.0f}" if abs(x - round(x)) < 0.05 else f"{x:+.1f}",
        }
        for x in anchor_candidates
    ]

    return {
        "horizon_key": horizon_key,
        "horizon_label": horizon_label,
        "slope_pp_per_eis": round(slope_f, 4),
        "intercept_pp": round(intercept_f, 4),
        "pearson_r": reg.get("r"),
        "n": n,
        "eis_observed_min": eis_min,
        "eis_observed_max": eis_max,
        "eis_median": round(_percentile(scores, 0.5), 3),
        "formula": f"ΔP ≈ {round(intercept_f, 2):+.2f} + {round(slope_f, 2):.2f} × EIS",
        "line": line,
        "anchors": anchors,
    }


def _expected_move_calibration_doc(
    event_rows: list[dict[str, Any]],
    reg_1d: dict[str, Any],
    reg_7d: dict[str, Any],
) -> dict[str, Any]:
    scores = [_float(r.get("eis_score")) for r in event_rows]
    scores = [s for s in scores if s is not None]
    t1 = _build_expected_move_calibration(
        reg_1d,
        scores,
        horizon_key="t1",
        horizon_label="T+1 (~24h)",
    )
    t7 = _build_expected_move_calibration(
        reg_7d,
        scores,
        horizon_key="t7",
        horizon_label="T+7 (~1 week)",
    )
    out: dict[str, Any] = {"built_from": "cohort_ols", "horizons": {}}
    if t1:
        out["horizons"]["t1"] = t1
    if t7:
        out["horizons"]["t7"] = t7
    return out


def build_eis_magnitude_analysis(
    *,
    snapshot_path: Path | str | None = None,
) -> dict[str, Any]:
    path = Path(snapshot_path) if snapshot_path else _CLINICAL_SNAPSHOT
    records: list[dict[str, Any]] = []
    if path.is_file():
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            records = list(doc.get("records") or [])
        except (OSError, json.JSONDecodeError):
            records = []

    event_rows = _iter_scored_feed_events(records)
    low, high, threshold = _split_high_low(event_rows)
    negative_rows = [r for r in event_rows if (_float(r.get("eis_score")) or 0) < 0]
    positive_rows = [r for r in event_rows if (_float(r.get("eis_score")) or 0) > 0]

    d3_pairs = [
        (_float(r["eis_score"]), _float(r["delta_p_3d"]))
        for r in event_rows
        if _float(r.get("eis_score")) is not None and _float(r.get("delta_p_3d")) is not None
    ]
    d1_pairs = [
        (_float(r["eis_score"]), _float(r["delta_p_1d"]))
        for r in event_rows
        if _float(r.get("eis_score")) is not None and _float(r.get("delta_p_1d")) is not None
    ]
    d7_pairs = [
        (_float(r["eis_score"]), _float(r["delta_p_7d"]))
        for r in event_rows
        if _float(r.get("eis_score")) is not None and _float(r.get("delta_p_7d")) is not None
    ]
    xs3 = [p[0] for p in d3_pairs]
    ys3 = [p[1] for p in d3_pairs]
    xs1 = [p[0] for p in d1_pairs]
    ys1 = [p[1] for p in d1_pairs]
    xs7 = [p[0] for p in d7_pairs]
    ys7 = [p[1] for p in d7_pairs]

    temporal = _temporal_radius_rows(event_rows)
    temporal_reg = _temporal_regression_rows(event_rows)
    temporal_sign = _temporal_sign_split_rows(event_rows)
    scatter_1d = _scatter_regression_payload(event_rows, price_key="delta_p_1d")
    scatter_7d = _scatter_regression_payload(event_rows, price_key="delta_p_7d")
    reg_1d_overall = scatter_1d["regression"]
    reg_7d_overall = scatter_7d["regression"]
    peak = _pick_peak_regression_window(temporal_reg) or _pick_peak_window(temporal)
    low_stats = _cohort_price_stats(low, price_key="delta_p_3d")
    high_stats = _cohort_price_stats(high, price_key="delta_p_3d")
    neg_stats = _cohort_price_stats(negative_rows, price_key="delta_p_3d")
    pos_stats = _cohort_price_stats(positive_rows, price_key="delta_p_3d")
    avg_low = low_stats.get("avg_move_pp")
    avg_high = high_stats.get("avg_move_pp")

    return {
        "schema_version": 2,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "scope": "scored_eis_events_only",
        "n_events_scored": len(event_rows),
        "n_with_price_1d": len(d1_pairs),
        "n_with_price_3d": len(d3_pairs),
        "n_with_price_7d": len(d7_pairs),
        "split": {
            "method": "median",
            "threshold": threshold,
            "low_eis": low_stats,
            "high_eis": high_stats,
            "high_minus_low_avg_d3_pp": (
                round(float(avg_high) - float(avg_low), 3)
                if avg_high is not None and avg_low is not None
                else None
            ),
            "high_minus_low_positive_rate_pp": (
                round(float(high_stats["pct_positive"]) - float(low_stats["pct_positive"]), 2)
                if high_stats.get("pct_positive") is not None and low_stats.get("pct_positive") is not None
                else None
            ),
        },
        "sign_split": {
            "negative_eis": neg_stats,
            "positive_eis": pos_stats,
        },
        "correlation": {
            "price_horizon_short": "T+1 session (~24h)",
            "price_horizon_week": "T+5 sessions (~1 trading week)",
            "pearson_eis_vs_delta_p_3d": _pearson(xs3, ys3),
            "spearman_eis_vs_delta_p_3d": _spearman(xs3, ys3),
            "pearson_eis_vs_delta_p_1d": _pearson(xs1, ys1),
            "pearson_eis_vs_delta_p_7d": _pearson(xs7, ys7),
            "regression_1d": reg_1d_overall,
            "regression_7d": reg_7d_overall,
            "n_3d": len(d3_pairs),
            "n_1d": len(d1_pairs),
            "n_7d": len(d7_pairs),
        },
        "temporal_radius": temporal,
        "temporal_regression": temporal_reg,
        "temporal_sign_split": temporal_sign,
        "scatter": {
            "delta_p_1d": scatter_1d,
            "delta_p_7d": scatter_7d,
        },
        "expected_move_calibration": _expected_move_calibration_doc(
            event_rows,
            reg_1d_overall,
            reg_7d_overall,
        ),
        "peak_window": peak,
    }


def persist_eis_magnitude_analysis(
    doc: dict[str, Any] | None = None,
    *,
    snapshot_path: Path | str | None = None,
) -> dict[str, Any]:
    """Write stable chart payload to data/eis_magnitude_analysis.json (UI offline cache)."""
    payload = doc if doc is not None else build_eis_magnitude_analysis()
    path = Path(snapshot_path) if snapshot_path else _EIS_MAGNITUDE_SNAPSHOT
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return payload


__all__ = [
    "build_eis_magnitude_analysis",
    "persist_eis_magnitude_analysis",
    "TEMPORAL_WINDOWS",
    "EIS_MAGNITUDE_SNAPSHOT_PATH",
]

EIS_MAGNITUDE_SNAPSHOT_PATH = _EIS_MAGNITUDE_SNAPSHOT
