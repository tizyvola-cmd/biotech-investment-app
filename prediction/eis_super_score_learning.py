"""
EIS Super Score — learning loop with CD-distance blend and correlation timeline.

Super score = blend( raw EIS×CD factor , learned window calibration ).
Persisted to data/eis_super_score_learning.json; consumed by Learning Lab UI.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR
from prediction.eis_magnitude_analysis import (
    EIS_ZERO_EPS,
    _iter_scored_feed_events,
    _pearson,
)

_EIS_SUPER_SCORE_JSON = Path(DATA_DIR) / "eis_super_score_learning.json"
_CLINICAL_SNAPSHOT = Path(DATA_DIR) / "clinical_pre_cd_enrichment_snapshot.json"


def _load_clinical_records() -> list[dict[str, Any]]:
    if not _CLINICAL_SNAPSHOT.is_file():
        return []
    try:
        doc = json.loads(_CLINICAL_SNAPSHOT.read_text(encoding="utf-8"))
        return list(doc.get("records") or [])
    except (OSError, json.JSONDecodeError):
        return []

# Finer bins approaching CD (days before Completion Date).
CD_CORRELATION_BINS: tuple[tuple[int, int, str], ...] = (
    (181, 9999, "180d+"),
    (121, 180, "121–180d"),
    (91, 120, "91–120d"),
    (61, 90, "61–90d"),
    (46, 60, "46–60d"),
    (31, 45, "31–45d"),
    (16, 30, "16–30d"),
    (8, 15, "8–15d"),
    (0, 7, "0–7d"),
)

CD_DISTANCE_FACTORS: tuple[tuple[int, int, float], ...] = (
    (0, 30, 1.0),
    (31, 60, 0.85),
    (61, 90, 0.7),
    (91, 180, 0.55),
    (181, 9999, 0.4),
)

EIS_LEARNED_BLEND = 0.65  # weight on newly observed window cal vs prior
EIS_GLOBAL_SCORE_BLEND = 0.6  # 60% learned path / 40% raw in super score
EIS_WINDOW_MIN_SAMPLES = 5
EIS_CAL_FLOOR = 0.45
EIS_CAL_CEILING = 2.2


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


def cd_distance_factor(days_before_cd: int | None) -> float:
    if days_before_cd is None or days_before_cd < 0:
        return 0.5
    d = int(days_before_cd)
    for lo, hi, factor in CD_DISTANCE_FACTORS:
        if lo <= d <= hi:
            return factor
    return 0.4


def resolve_cd_bin(days_before_cd: int | None) -> tuple[int, int, str] | None:
    if days_before_cd is None or days_before_cd < 0:
        return None
    d = int(days_before_cd)
    for lo, hi, label in CD_CORRELATION_BINS:
        if lo <= d <= hi:
            return lo, hi, label
    return None


def default_learning_state() -> dict[str, Any]:
    windows: dict[str, Any] = {}
    for lo, hi, label in CD_CORRELATION_BINS:
        windows[label] = {
            "days_min": lo,
            "days_max": hi if hi < 9999 else None,
            "cal_factor": 1.0,
            "n_samples": 0,
            "last_updated": None,
        }
    return {
        "schema_version": 1,
        "generated_at": _now_iso(),
        "global_score_blend": EIS_GLOBAL_SCORE_BLEND,
        "learned_blend": EIS_LEARNED_BLEND,
        "windows": windows,
        "history": [],
    }


def load_eis_super_score_state() -> dict[str, Any]:
    doc = _load_json(_EIS_SUPER_SCORE_JSON, default_learning_state())
    if not isinstance(doc, dict):
        return default_learning_state()
    if not doc.get("windows"):
        base = default_learning_state()
        base.update({k: v for k, v in doc.items() if k != "windows"})
        doc = base
    return doc


def compute_raw_eis_component(eis_score: float, days_before_cd: int | None) -> float:
    return round(eis_score * cd_distance_factor(days_before_cd), 4)


def compute_super_score(
    eis_score: float,
    days_before_cd: int | None,
    state: dict[str, Any] | None = None,
) -> float:
    st = state or load_eis_super_score_state()
    raw = compute_raw_eis_component(eis_score, days_before_cd)
    bin_row = resolve_cd_bin(days_before_cd)
    if not bin_row:
        return raw
    _lo, _hi, label = bin_row
    win = (st.get("windows") or {}).get(label) or {}
    cal = float(win.get("cal_factor") or 1.0)
    blend = float(st.get("global_score_blend") or EIS_GLOBAL_SCORE_BLEND)
    learned = raw * cal
    return round(blend * learned + (1.0 - blend) * raw, 4)


def _forward_return_pp(row: dict[str, Any], horizon: str) -> float | None:
    key = {"1d": "delta_p_1d", "7d": "delta_p_7d", "3d": "delta_p_3d"}.get(horizon)
    if not key:
        return None
    v = row.get(key)
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _bin_mid(lo: int, hi: int) -> int:
    if hi >= 9999:
        return lo + 30
    return round((lo + hi) / 2)


def build_correlation_timeline(
    event_rows: list[dict[str, Any]] | None = None,
    *,
    state: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Pearson ρ(super/raw score, forward ΔP) per CD-distance bin — timeline to CD."""
    rows = event_rows if event_rows is not None else _iter_scored_feed_events(_load_clinical_records())
    st = state or load_eis_super_score_state()
    out: list[dict[str, Any]] = []

    for lo, hi, label in CD_CORRELATION_BINS:
        subset = [r for r in rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        raw_1d: list[tuple[float, float]] = []
        sup_1d: list[tuple[float, float]] = []
        raw_7d: list[tuple[float, float]] = []
        sup_7d: list[tuple[float, float]] = []

        for r in subset:
            eis = r.get("eis_score")
            if eis is None:
                continue
            try:
                es = float(eis)
            except (TypeError, ValueError):
                continue
            if abs(es) <= EIS_ZERO_EPS:
                continue
            dbc = int(r.get("days_before_cd") or 0)
            raw = compute_raw_eis_component(es, dbc)
            sup = compute_super_score(es, dbc, st)
            d1 = _forward_return_pp(r, "1d")
            d7 = _forward_return_pp(r, "7d")
            if d1 is not None:
                raw_1d.append((raw, d1))
                sup_1d.append((sup, d1))
            if d7 is not None:
                raw_7d.append((raw, d7))
                sup_7d.append((sup, d7))

        def _rho(pairs: list[tuple[float, float]]) -> float | None:
            if len(pairs) < 3:
                return None
            xs = [p[0] for p in pairs]
            ys = [p[1] for p in pairs]
            return _pearson(xs, ys)

        raw_r1 = _rho(raw_1d)
        sup_r1 = _rho(sup_1d)
        raw_r7 = _rho(raw_7d)
        sup_r7 = _rho(sup_7d)

        out.append(
            {
                "window": label,
                "days_min": lo,
                "days_max": hi if hi < 9999 else None,
                "days_mid": _bin_mid(lo, hi),
                "n_events": len(subset),
                "n_price_1d": len(raw_1d),
                "n_price_7d": len(raw_7d),
                "corr_raw_1d": raw_r1,
                "corr_super_1d": sup_r1,
                "corr_raw_7d": raw_r7,
                "corr_super_7d": sup_r7,
                "lift_1d": round(sup_r1 - raw_r1, 4) if sup_r1 is not None and raw_r1 is not None else None,
                "lift_7d": round(sup_r7 - raw_r7, 4) if sup_r7 is not None and raw_r7 is not None else None,
                "cal_factor": (st.get("windows") or {}).get(label, {}).get("cal_factor"),
            }
        )
    return out


def _observed_window_cal(subset: list[dict[str, Any]]) -> float | None:
    """Median |ΔP| / |EIS| scale for events with price at T+7."""
    ratios: list[float] = []
    for r in subset:
        eis = r.get("eis_score")
        d7 = _forward_return_pp(r, "7d")
        if eis is None or d7 is None:
            continue
        try:
            es = abs(float(eis))
        except (TypeError, ValueError):
            continue
        if es < 8:
            continue
        dbc = int(r.get("days_before_cd") or 0)
        raw = abs(compute_raw_eis_component(float(r["eis_score"]), dbc))
        if raw < 1e-6:
            continue
        ratios.append(abs(d7) / raw)
    if len(ratios) < 3:
        return None
    ratios.sort()
    mid = len(ratios) // 2
    return ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2.0


def run_eis_super_score_learning_cycle(*, dry_run: bool = True) -> dict[str, Any]:
    """Update per-window cal_factor from observed EIS→price coupling; append weekly snapshot."""
    rows = _iter_scored_feed_events(_load_clinical_records())
    prev = load_eis_super_score_state()
    windows = dict(prev.get("windows") or {})
    blend = float(prev.get("learned_blend") or EIS_LEARNED_BLEND)
    changes: list[dict[str, Any]] = []

    for lo, hi, label in CD_CORRELATION_BINS:
        subset = [r for r in rows if lo <= int(r.get("days_before_cd") or -1) <= hi]
        win = dict(windows.get(label) or {})
        old_cal = float(win.get("cal_factor") or 1.0)
        observed = _observed_window_cal(subset)
        new_cal = old_cal
        if observed is not None and len(subset) >= EIS_WINDOW_MIN_SAMPLES:
            target = max(EIS_CAL_FLOOR, min(EIS_CAL_CEILING, observed))
            new_cal = round(old_cal * (1.0 - blend) + target * blend, 4)
            new_cal = max(EIS_CAL_FLOOR, min(EIS_CAL_CEILING, new_cal))
        if abs(new_cal - old_cal) > 0.01:
            changes.append({"window": label, "from": old_cal, "to": new_cal, "n": len(subset)})
        windows[label] = {
            "days_min": lo,
            "days_max": hi if hi < 9999 else None,
            "cal_factor": new_cal,
            "n_samples": len(subset),
            "last_updated": _today_iso() if not dry_run and observed is not None else win.get("last_updated"),
        }

    timeline = build_correlation_timeline(rows, state={**prev, "windows": windows})

    def _mean_rho(key: str) -> float | None:
        vals = [float(r[key]) for r in timeline if r.get(key) is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), 4)

    effectiveness = {
        "mean_corr_raw_7d": _mean_rho("corr_raw_7d"),
        "mean_corr_super_7d": _mean_rho("corr_super_7d"),
        "mean_lift_7d": _mean_rho("lift_7d"),
        "bins_with_data_7d": sum(1 for r in timeline if r.get("corr_super_7d") is not None),
    }

    doc: dict[str, Any] = {
        **prev,
        "generated_at": _now_iso(),
        "windows": windows,
        "correlation_timeline": timeline,
        "effectiveness": effectiveness,
        "n_events_scored": len(rows),
    }

    if not dry_run:
        history = list(prev.get("history") or [])
        history.append(
            {
                "week": _today_iso()[:7],
                "date": _today_iso(),
                "mean_corr_raw_7d": effectiveness.get("mean_corr_raw_7d"),
                "mean_corr_super_7d": effectiveness.get("mean_corr_super_7d"),
                "mean_lift_7d": effectiveness.get("mean_lift_7d"),
                "changes": changes,
            }
        )
        doc["history"] = history[-52:]
        _save_json(_EIS_SUPER_SCORE_JSON, doc)
    else:
        doc["history"] = prev.get("history") or []

    return {
        "ok": True,
        "dry_run": dry_run,
        "changes": changes,
        "effectiveness": effectiveness,
        "correlation_timeline": timeline,
        "doc": doc,
    }


def build_eis_super_score_overview() -> dict[str, Any]:
    """Stable payload for Learning Lab + API."""
    st = load_eis_super_score_state()
    rows = _iter_scored_feed_events(_load_clinical_records())
    timeline = build_correlation_timeline(rows, state=st)
    eff = st.get("effectiveness") if isinstance(st.get("effectiveness"), dict) else {}
    if not eff:
        eff = run_eis_super_score_learning_cycle(dry_run=True).get("effectiveness") or {}

    history = st.get("history") if isinstance(st.get("history"), list) else []
    return {
        "generated_at": st.get("generated_at") or _now_iso(),
        "global_score_blend": st.get("global_score_blend", EIS_GLOBAL_SCORE_BLEND),
        "learned_blend": st.get("learned_blend", EIS_LEARNED_BLEND),
        "windows": st.get("windows") or {},
        "correlation_timeline": timeline,
        "effectiveness": eff,
        "learning_history": history,
        "n_events_scored": len(rows),
    }


def persist_eis_super_score_learning(*, dry_run: bool = False) -> dict[str, Any]:
    return run_eis_super_score_learning_cycle(dry_run=dry_run)


__all__ = [
    "CD_CORRELATION_BINS",
    "compute_super_score",
    "compute_raw_eis_component",
    "build_correlation_timeline",
    "run_eis_super_score_learning_cycle",
    "build_eis_super_score_overview",
    "load_eis_super_score_state",
    "persist_eis_super_score_learning",
    "EIS_SUPER_SCORE_JSON",
]

EIS_SUPER_SCORE_JSON = _EIS_SUPER_SCORE_JSON
