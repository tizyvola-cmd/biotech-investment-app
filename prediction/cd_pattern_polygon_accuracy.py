"""
Recommendation polygon accuracy — Pearson ρ(match %, stock % vs T−60) by distance to CD.

Uses past catalyst records: at each calendar knot on the pre-CD arc, recomputes a
retro polygon match score (RA / SDS / MII / calib / slope vs window thresholds)
and correlates it with realized % vs T−60 at the same knot.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map
from prediction.eis_magnitude_analysis import _pearson
from prediction.sds_roi_correlation import _expand_knot_series, _float_or_none
from prediction.v5.cohort_prior import realized_pct_vs_m60_at_offset

_POLYGON_ACCURACY_JSON = Path(DATA_DIR) / "cd_pattern_polygon_accuracy.json"

EVAL_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4)

# Mirrors desktop-ui cdPatternHorizons.ts CD_PATTERN_WINDOWS (pre-CD arc T−60→T+4).
@dataclass(frozen=True)
class _PatternWindow:
    id: str
    start: int
    end: int
    label: str
    ra_min: float
    sds_min: float
    slope20_min: float
    mii_min: float
    calib_min: float


_PATTERN_WINDOWS: tuple[_PatternWindow, ...] = (
    _PatternWindow("w1", -60, -30, "T−60→T−30", 40, 45, 0, 0, 40),
    _PatternWindow("w2", -30, -10, "T−30→T−10", 48, 50, 0, 3, 50),
    _PatternWindow("w3", -10, -7, "T−10→T−7", 52, 55, 0.05, 5, 55),
    _PatternWindow("w4", -7, -3, "T−7→T−3", 55, 60, 0.1, 8, 60),
    _PatternWindow("w5", -3, 4, "T−3→T+4", 55, 65, 0.1, 10, 65),
)

_CORRELATION_BINS: tuple[tuple[int, int, str, str], ...] = (
    (30, 60, "T−60→T−30", "w1"),
    (10, 29, "T−30→T−10", "w2"),
    (7, 9, "T−10→T−7", "w3"),
    (3, 6, "T−7→T−3", "w4"),
    (0, 3, "T−3→T+4", "w5"),
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _today_iso() -> str:
    return date.today().isoformat()


def load_cd_pattern_polygon_state() -> dict[str, Any]:
    cached = _load_json(_POLYGON_ACCURACY_JSON, {})
    return cached if isinstance(cached, dict) else {}


def append_polygon_learning_history(doc: dict[str, Any], prev: dict[str, Any] | None) -> dict[str, Any]:
    """Append weekly snapshot of mean ρ and per-window correlations."""
    eff = doc.get("effectiveness") if isinstance(doc.get("effectiveness"), dict) else {}
    week = _today_iso()
    timeline = doc.get("correlation_timeline") if isinstance(doc.get("correlation_timeline"), list) else []
    entry: dict[str, Any] = {
        "week": week,
        "date": week,
        "mean_corr_match_stock": eff.get("mean_corr_match_stock"),
        "bins_with_data": eff.get("bins_with_data"),
        "n_samples": doc.get("n_samples"),
        "n_events": doc.get("n_events"),
        "by_window": {
            str(r.get("window_id") or r.get("window")): r.get("corr_match_stock")
            for r in timeline
            if isinstance(r, dict)
        },
    }
    history = list((prev or {}).get("learning_history") or [])
    history = [h for h in history if isinstance(h, dict) and h.get("week") != week and h.get("date") != week]
    history.append(entry)
    doc["learning_history"] = history[-52:]
    return doc


def polygon_mean_corr_changes(prev: dict[str, Any], doc: dict[str, Any]) -> list[dict[str, Any]]:
    old_mean = (prev.get("effectiveness") or {}).get("mean_corr_match_stock")
    new_mean = (doc.get("effectiveness") or {}).get("mean_corr_match_stock")
    if old_mean is None or new_mean is None:
        return []
    if abs(float(new_mean) - float(old_mean)) < 0.005:
        return []
    return [
        {
            "metric": "mean_corr_match_stock",
            "from": round(float(old_mean), 4),
            "to": round(float(new_mean), 4),
            "n_samples": doc.get("n_samples"),
            "n_events": doc.get("n_events"),
        }
    ]


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


def _axis_pct(value: float | None, minimum: float, *, higher_is_better: bool = True) -> float:
    if value is None or not math.isfinite(value):
        return 0.0
    if minimum <= 0:
        if not higher_is_better:
            return 100.0 if value <= minimum else 0.0
        return 100.0 if value >= 0 else 0.0
    ratio = value / minimum
    return float(min(100.0, max(0.0, round(ratio * 100.0))))


def _resolve_window(offset: int) -> _PatternWindow | None:
    for w in _PATTERN_WINDOWS:
        if w.id == "w5":
            if w.start <= offset <= w.end:
                return w
            continue
        if w.start <= offset < w.end:
            return w
    if offset < _PATTERN_WINDOWS[0].start:
        return _PATTERN_WINDOWS[0]
    return None


def _days_before_cd(offset: int) -> int:
    if offset <= 0:
        return max(0, -offset)
    return 0


def _bin_mid(lo: int, hi: int) -> int:
    return round((lo + hi) / 2)


def _slope20_pp_per_day(rec: dict[str, Any], end_off: int) -> float | None:
    pts: list[tuple[int, float]] = []
    for off in (-60, -30, -10, -7, -5, -3, 0, 4):
        if off > end_off:
            continue
        v = realized_pct_vs_m60_at_offset(rec, off)
        if v is not None:
            pts.append((off, v))
    if len(pts) < 2:
        return None
    pts.sort(key=lambda x: x[0])
    # ~20 sessions ≈ 20 calendar steps on offset axis (proxy).
    tail = pts[-2:]
    d_off = tail[1][0] - tail[0][0]
    if d_off == 0:
        return None
    return round((tail[1][1] - tail[0][1]) / max(abs(d_off), 1) / 5.0, 4)


def _retro_sds(rec: dict[str, Any], days_to_cd: int) -> float | None:
    try:
        from dataclasses import replace

        from prediction.sds_roi_correlation import build_retro_sds_input_from_past
        from prediction.supernova_score import compute_sds

        inp = build_retro_sds_input_from_past(rec)
        if inp is None:
            return None
        inp = replace(inp, days_to_cd=max(1, days_to_cd))
        row = compute_sds(inp)
        return _float_or_none(row.sds)
    except Exception:
        return None


def compute_polygon_match_pct(rec: dict[str, Any], offset: int) -> float | None:
    window = _resolve_window(offset)
    if not window:
        return None
    dbc = _days_before_cd(offset)
    sds = _retro_sds(rec, max(dbc, 3))
    ra = _float_or_none(rec.get("affidabilita_calib") or rec.get("affidabilita"))
    calib = _float_or_none(rec.get("affidabilita_calib") or rec.get("affidabilita"))
    slope20 = _slope20_pp_per_day(rec, offset)
    mii = abs(slope20 or 0) * 15.0 if slope20 is not None else None

    axes = [
        _axis_pct(ra, window.ra_min),
        _axis_pct(sds, window.sds_min),
        _axis_pct(mii, window.mii_min),
        _axis_pct(calib, window.calib_min),
        _axis_pct(slope20, window.slope20_min) if slope20 is not None and slope20 >= window.slope20_min else _axis_pct(slope20, window.slope20_min),
    ]
    return round(sum(axes) / len(axes), 1)


def _collect_samples(past_map: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    src = past_map if past_map is not None else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    out: list[dict[str, Any]] = []
    for rec in src.values():
        if not isinstance(rec, dict):
            continue
        for off in EVAL_OFFSETS:
            stock_pct = realized_pct_vs_m60_at_offset(rec, off)
            match_pct = compute_polygon_match_pct(rec, off)
            if stock_pct is None or match_pct is None:
                continue
            dbc = _days_before_cd(off)
            out.append(
                {
                    "ticker": str(rec.get("ticker") or "").upper(),
                    "offset": off,
                    "days_before_cd": dbc,
                    "match_pct": match_pct,
                    "stock_pct": stock_pct,
                    "window_id": _resolve_window(off).id if _resolve_window(off) else None,
                }
            )
    return out


def build_correlation_timeline(
    samples: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    rows = samples if samples is not None else _collect_samples()
    out: list[dict[str, Any]] = []

    for lo, hi, label, wid in _CORRELATION_BINS:
        subset = [r for r in rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        pairs = [(float(r["match_pct"]), float(r["stock_pct"])) for r in subset if r.get("match_pct") is not None and r.get("stock_pct") is not None]
        rho: float | None = None
        if len(pairs) >= 3:
            xs = [p[0] for p in pairs]
            ys = [p[1] for p in pairs]
            rho = _pearson(xs, ys)

        out.append(
            {
                "window": label,
                "window_id": wid,
                "days_min": lo,
                "days_max": hi,
                "days_mid": _bin_mid(lo, hi),
                "n_samples": len(pairs),
                "corr_match_stock": round(rho, 4) if rho is not None else None,
            }
        )
    return out


def build_cd_pattern_polygon_overview(
    past_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    samples = _collect_samples(past_map)
    timeline = build_correlation_timeline(samples)

    rhos = [float(r["corr_match_stock"]) for r in timeline if r.get("corr_match_stock") is not None]
    mean_rho = round(sum(rhos) / len(rhos), 4) if rhos else None

    tickers = {s.get("ticker") for s in samples if s.get("ticker")}
    return {
        "generated_at": _now_iso(),
        "correlation_timeline": timeline,
        "n_samples": len(samples),
        "n_events": len(tickers),
        "effectiveness": {
            "mean_corr_match_stock": mean_rho,
            "bins_with_data": len(rhos),
        },
    }


def persist_cd_pattern_polygon_accuracy(*, dry_run: bool = False) -> dict[str, Any]:
    prev = load_cd_pattern_polygon_state()
    doc = build_cd_pattern_polygon_overview()
    changes = polygon_mean_corr_changes(prev, doc)
    if not dry_run:
        doc = append_polygon_learning_history(doc, prev)
        _save_json(_POLYGON_ACCURACY_JSON, doc)
    else:
        doc["learning_history"] = prev.get("learning_history") or []
    if changes:
        doc["changes"] = changes
    return doc


def load_cd_pattern_polygon_accuracy() -> dict[str, Any]:
    cached = load_cd_pattern_polygon_state()
    if cached.get("correlation_timeline"):
        return cached
    return build_cd_pattern_polygon_overview()


__all__ = [
    "build_cd_pattern_polygon_overview",
    "build_correlation_timeline",
    "compute_polygon_match_pct",
    "load_cd_pattern_polygon_accuracy",
    "load_cd_pattern_polygon_state",
    "persist_cd_pattern_polygon_accuracy",
    "polygon_mean_corr_changes",
    "append_polygon_learning_history",
    "POLYGON_ACCURACY_JSON",
]

POLYGON_ACCURACY_JSON = _POLYGON_ACCURACY_JSON
