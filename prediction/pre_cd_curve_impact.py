"""
Pre-CD curve quality: distance between **simulation curve trajectories** and **realized path**
(% vs T−60), cumulative over historical catalyst events.

Four levels (aligned with Simulation sparklines):
  - base (grey):   raw polynomial model — no recalib
  - daily (blue):  seq_curve / calendar close anchoring (chiusura giornaliera)
  - k8 (teal):     seq_curve + K-8 knots (pct_foglio / chart bundle when available)
  - eis (purple):  k8 path + EIS shift (Catalyst Feed KPI)

Also builds ``enrichment_chart_series``: cumulative RMSE on events with Catalyst Feed /
EIS metadata — grows as historic enrich backfill adds rows.

Metric per event: RMSE(model_path, actual_path) on pre-CD nodes −60…−3.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    PAST_CATALYST_PREDICTIONS_JSON,
    SIMULATION_CHARTS_SNAPSHOT_JSON,
)
from past_pred_io import load_past_pred_document, rows_map_from_doc
from prediction.past_pred_display_enrich import (
    cal_factor_v4_from_state,
    ensure_past_pred_display_enriched,
)

_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_CALIB = _ROOT / "data" / "model_calibration_state.json"
_CLINICAL_SNAPSHOT = _ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"
_CURVE_IMPACT_STATE = _ROOT / "data" / "curve_impact_cumulative_state.json"

FLAT_BAND_PP = 0.5
MAX_CHART_POINTS = 180
STATE_SCHEMA_VERSION = 2

PATH_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3)
RECALIB_SCHEDULE: tuple[int, ...] = (-60, -30, -10, -7, -5)

_OFFSET_CLOSE_KEY: dict[int, str] = {
    -60: "close_m60",
    -30: "close_m30",
    -10: "close_m10",
    -7: "close_m7",
    -5: "close_m5",
    -3: "close_m3",
}

_OFFSET_MODEL_KEY: dict[int, str] = {
    -60: "model_dm60_pct",
    -30: "model_dm30_pct",
    -10: "model_dm10_pct",
    -7: "model_dm7_pct",
    -5: "model_dm5_pct",
    -3: "model_dm3_pct",
}


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _parse_day(rec: dict) -> str | None:
    cd = rec.get("completion_date")
    if hasattr(cd, "isoformat"):
        return cd.isoformat()[:10]
    if cd:
        s = str(cd).strip()[:10]
        if len(s) >= 10 and s[4] == "-":
            return s
    return None


def _event_fingerprint(ticker: str, day: str | None) -> str:
    return f"{ticker.upper()}|{day or ''}"


def _direction_hit(pred: float, actual: float, band: float = FLAT_BAND_PP) -> bool:
    if abs(actual) <= band:
        return abs(pred) <= band
    return (pred > band and actual > band) or (pred < -band and actual < -band)


def _resolve_pred_levels(rec: dict, *, cf_default: float) -> dict[str, float | None] | None:
    fit = _num(rec.get("pred_dm5_fit_pct"))
    if fit is None:
        fit = _num(rec.get("model_dm5_pct"))
    if fit is None:
        return None

    cf_row = _num(rec.get("cal_factor"))
    cf = cf_row if cf_row is not None and cf_row > 0 else cf_default

    display = _num(rec.get("model_dm5_display_pct"))
    eis = _num(rec.get("eis_poly_shift_pp"))
    if eis is None:
        eis = 0.0

    pred_base = round(fit, 3)
    pred_post_eis = round(fit + eis, 3)
    if display is not None:
        pred_final = round(display, 3)
    else:
        pred_final = round(pred_post_eis * cf, 3)

    return {
        "pred_base_pp": pred_base,
        "pred_post_eis_pp": pred_post_eis,
        "pred_final_pp": pred_final,
        "cal_factor": round(cf, 4),
        "eis_shift_pp": round(eis, 3),
    }


def _actual_path_pct(rec: dict, offsets: tuple[int, ...] = PATH_OFFSETS) -> list[float | None] | None:
    c60 = _num(rec.get("close_m60"))
    if c60 is None or c60 <= 0:
        return None
    out: list[float | None] = []
    for off in offsets:
        if off == -60:
            out.append(0.0)
            continue
        key = _OFFSET_CLOSE_KEY.get(off)
        if not key:
            out.append(None)
            continue
        c = _num(rec.get(key))
        if c is None or c <= 0:
            out.append(None)
        else:
            out.append(round((c / c60 - 1.0) * 100.0, 3))
    return out


def _interp_offset_path(offsets: tuple[int, ...], anchors: dict[int, float]) -> list[float | None]:
    if not anchors:
        return [None] * len(offsets)
    known = sorted(anchors.keys())
    out: list[float | None] = []
    for off in offsets:
        if off in anchors:
            out.append(round(anchors[off], 3))
            continue
        prev = next((k for k in reversed(known) if k < off), None)
        nxt = next((k for k in known if k > off), None)
        if prev is not None and nxt is not None and nxt != prev:
            t = (off - prev) / (nxt - prev)
            out.append(round(anchors[prev] * (1.0 - t) + anchors[nxt] * t, 3))
        elif prev is not None:
            out.append(round(anchors[prev], 3))
        elif nxt is not None:
            out.append(round(anchors[nxt], 3))
        else:
            out.append(None)
    return out


def _model_raw_path_pct(rec: dict, offsets: tuple[int, ...] = PATH_OFFSETS) -> list[float | None] | None:
    try:
        import data_orchestrator as orch

        dd = dict(rec)
        dd.pop("cal_factor", None)
        dd.pop("model_dm5_display_pct", None)
        raw = orch._interp_pred_pct_vs_m60_calendar(dd, offsets)
        if isinstance(raw, list) and any(x is not None for x in raw):
            try:
                from prediction.curve_display import cal_factor_v4_from_row

                cf = cal_factor_v4_from_row(rec)
                if cf and abs(cf - 1.0) > 1e-4:
                    unscaled: list[float | None] = []
                    for i, off in enumerate(offsets):
                        p = raw[i] if i < len(raw) else None
                        if p is None:
                            unscaled.append(None)
                        elif int(off) == -60:
                            unscaled.append(round(float(p), 3))
                        else:
                            unscaled.append(round(float(p) / cf, 3))
                    raw = unscaled
            except Exception:
                pass
            return [
                round(float(x), 3) if x is not None and math.isfinite(float(x)) else None
                for x in raw
            ]
    except Exception:
        pass

    fit = _num(rec.get("pred_dm5_fit_pct"))
    if fit is None:
        fit = _num(rec.get("model_dm5_pct"))

    anchors: dict[int, float] = {}
    if fit is not None:
        anchors[-5] = fit
    for off, key in _OFFSET_MODEL_KEY.items():
        v = _num(rec.get(key))
        if v is not None:
            if fit is not None and off == -5:
                anchors[off] = fit
            else:
                anchors[off] = v

    if len(anchors) < 2:
        return None
    return _interp_offset_path(offsets, anchors)


def _path_from_knot_snapshots(
    rec: dict,
    offsets: tuple[int, ...] = PATH_OFFSETS,
) -> list[float | None] | None:
    snaps = rec.get("seq_curve_knot_snapshots")
    if not isinstance(snaps, list) or not snaps:
        return None
    anchors: dict[int, float] = {-60: 0.0}
    for s in snaps:
        if not isinstance(s, dict):
            continue
        off = s.get("cal_offset")
        pct = _num(s.get("pct_vs_p60"))
        if off is None or pct is None:
            continue
        anchors[int(off)] = pct
    if len(anchors) < 2:
        return None
    return _interp_offset_path(offsets, anchors)


def _path_from_seq_curve(
    rec: dict,
    offsets: tuple[int, ...] = PATH_OFFSETS,
) -> list[float | None] | None:
    seq = rec.get("seq_curve_pct_vs_m60")
    if not isinstance(seq, (list, tuple)) or not seq:
        return None
    try:
        import data_orchestrator as orch

        out: list[float | None] = []
        for off in offsets:
            if off == -60:
                out.append(0.0)
                continue
            v = orch._seq_curve_pct_at_cal_offset(seq, int(off))
            out.append(round(float(v), 3) if v is not None else None)
        if not any(v is not None for v in out):
            return None
        return out
    except Exception:
        return None


def _chart_series_key(ticker: str, day: str | None) -> str | None:
    if not ticker or not day:
        return None
    return f"co:{ticker.upper()}|{day}"


def _path_from_chart_points(
    points: list[dict] | None,
    offsets: tuple[int, ...],
    *,
    field: str,
    standard_only: bool = False,
) -> list[float | None] | None:
    if not points:
        return None
    anchors: dict[int, float] = {}
    for p in points:
        if not isinstance(p, dict):
            continue
        nodo = str(p.get("nodo") or "standard").strip()
        if standard_only and nodo not in ("standard", ""):
            continue
        off = p.get("offset")
        val = _num(p.get(field))
        if off is None or val is None:
            continue
        anchors[int(off)] = val
    if len(anchors) < 2:
        return None
    if -60 not in anchors:
        anchors[-60] = 0.0
    return _interp_offset_path(offsets, anchors)


def _load_chart_bundle(path: Path | None = None) -> dict[str, list[dict]]:
    p = path or Path(SIMULATION_CHARTS_SNAPSHOT_JSON)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        series = doc.get("series") or {}
        out: dict[str, list[dict]] = {}
        for k, v in series.items():
            if isinstance(v, list):
                out[str(k)] = [x for x in v if isinstance(x, dict)]
            elif isinstance(v, dict) and isinstance(v.get("points"), list):
                out[str(k)] = [x for x in v["points"] if isinstance(x, dict)]
        return out
    except Exception:
        return {}


EIS_ZERO_EPS = 1e-6


def _max_eis_score_from_feed_record(rec: dict[str, Any] | None) -> float | None:
    """Max |EIS score| from clinical feed events; None if no scored events."""
    if not rec:
        return None
    scores: list[float] = []
    for ev in rec.get("clinical_events") or rec.get("timeline_events") or []:
        if not isinstance(ev, dict):
            continue
        eis = ev.get("eis")
        if isinstance(eis, dict):
            sc = eis.get("score")
            if sc is not None:
                try:
                    scores.append(float(sc))
                except (TypeError, ValueError):
                    pass
    if not scores:
        return None
    return max(scores, key=lambda s: abs(s))


def _load_enrichment_records() -> dict[str, dict[str, Any]]:
    """``fingerprint`` → clinical pre-CD enrichment record."""
    out: dict[str, dict[str, Any]] = {}
    if not _CLINICAL_SNAPSHOT.is_file():
        return out
    try:
        doc = json.loads(_CLINICAL_SNAPSHOT.read_text(encoding="utf-8"))
        records = doc.get("records") or []
        for r in records:
            if not isinstance(r, dict):
                continue
            tk = str(r.get("ticker") or "").strip().upper()
            cd = r.get("cd_date") or r.get("completion_date")
            if hasattr(cd, "isoformat"):
                day = cd.isoformat()[:10]
            else:
                day = str(cd or "").strip()[:10]
            if not tk or len(day) < 10:
                continue
            fp = _event_fingerprint(tk, day)
            out[fp] = r
    except Exception:
        pass
    return out


def _load_enrichment_index() -> dict[str, str]:
    out: dict[str, str] = {}
    if not _CLINICAL_SNAPSHOT.is_file():
        return out
    try:
        doc = json.loads(_CLINICAL_SNAPSHOT.read_text(encoding="utf-8"))
        updated = str(doc.get("updated_at") or "")
        for fp, r in _load_enrichment_records().items():
            ts = str(
                r.get("deep_enriched_at") or r.get("enriched_at") or updated or ""
            ).strip()
            if ts:
                out[fp] = ts
    except Exception:
        pass
    return out


def _apply_eis_shift(path: list[float | None], eis_pp: float) -> list[float | None]:
    if abs(eis_pp) < 1e-6:
        return list(path)
    return [round(v + eis_pp, 3) if v is not None else None for v in path]


def _path_rmse(
    pred: list[float | None],
    actual: list[float | None],
    *,
    offsets: tuple[int, ...] = PATH_OFFSETS,
) -> float | None:
    errs: list[float] = []
    for i, (p, a) in enumerate(zip(pred, actual)):
        if offsets[i] > 0:
            continue
        if p is None or a is None:
            continue
        errs.append(abs(float(p) - float(a)))
    if not errs:
        return None
    return round(math.sqrt(sum(e * e for e in errs) / len(errs)), 3)


def _resolve_simulation_paths(
    rec: dict,
    *,
    chart_series: dict[str, list[dict]],
    offsets: tuple[int, ...] = PATH_OFFSETS,
) -> dict[str, Any]:
    raw = _model_raw_path_pct(rec, offsets)
    knot = _path_from_knot_snapshots(rec, offsets)
    seq = _path_from_seq_curve(rec, offsets)

    tk = str(rec.get("ticker") or "").upper()
    day = _parse_day(rec)
    ck = _chart_series_key(tk, day)
    chart_pts = chart_series.get(ck or "") if ck else None

    chart_model = (
        _path_from_chart_points(chart_pts, offsets, field="pct_modello") if chart_pts else None
    )
    chart_curva = (
        _path_from_chart_points(
            chart_pts, offsets, field="pct_curva", standard_only=True
        )
        if chart_pts
        else None
    )
    chart_foglio = (
        _path_from_chart_points(chart_pts, offsets, field="pct_foglio") if chart_pts else None
    )

    base = chart_model or raw
    daily = knot or seq or chart_curva
    k8 = seq or chart_foglio or daily

    levels = _resolve_pred_levels(rec, cf_default=1.0) or {}
    eis_pp = _num(levels.get("eis_shift_pp")) or 0.0
    eis = _apply_eis_shift(k8, eis_pp) if k8 else None

    return {
        "base": base,
        "daily": daily,
        "k8": k8,
        "eis": eis,
        "has_seq": seq is not None,
        "has_chart": chart_pts is not None,
        "has_knot": knot is not None,
        "has_daily_path": daily is not None,
        "has_k8_path": k8 is not None,
        "eis_pp": eis_pp,
    }


def _extract_event(
    rec: dict,
    *,
    cf_default: float,
    chart_series: dict[str, list[dict]],
    enrich_index: dict[str, str],
    enrich_records: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    actual = _actual_path_pct(rec)
    levels = _resolve_pred_levels(rec, cf_default=cf_default)
    paths = _resolve_simulation_paths(rec, chart_series=chart_series)

    raw = paths["base"]
    daily = paths["daily"]
    k8 = paths["k8"]
    with_eis = paths["eis"]

    if actual is None or raw is None or levels is None:
        return None
    if not any(a is not None for a in actual) or not any(r is not None for r in raw):
        return None

    rmse_base = _path_rmse(raw, actual)
    rmse_daily = _path_rmse(daily, actual) if daily else None
    rmse_k8 = _path_rmse(k8, actual) if k8 else None
    rmse_eis = _path_rmse(with_eis, actual) if with_eis else None
    if rmse_base is None:
        return None

    c60 = _num(rec.get("close_m60"))
    c5 = _num(rec.get("close_m5"))
    realized_t5 = round((c5 / c60 - 1.0) * 100.0, 3) if c60 and c5 and c60 > 0 else None

    base_t5 = levels["pred_base_pp"]
    idx5 = PATH_OFFSETS.index(-5)

    def _t5(path: list[float | None] | None) -> float | None:
        if not path or idx5 >= len(path):
            return None
        return path[idx5]

    hit_base = hit_daily = hit_k8 = hit_eis = False
    if realized_t5 is not None and base_t5 is not None:
        hit_base = _direction_hit(base_t5, realized_t5)
        d5 = _t5(daily)
        if d5 is not None:
            hit_daily = _direction_hit(d5, realized_t5)
        k5 = _t5(k8)
        if k5 is not None:
            hit_k8 = _direction_hit(k5, realized_t5)
        e5 = _t5(with_eis)
        if e5 is not None:
            hit_eis = _direction_hit(e5, realized_t5)

    raw_eis_path = _apply_eis_shift(raw, paths["eis_pp"]) if raw else None
    hit_raw_eis = False
    if realized_t5 is not None and raw_eis_path:
        e5_raw_eis = _t5(raw_eis_path)
        if e5_raw_eis is not None:
            hit_raw_eis = _direction_hit(e5_raw_eis, realized_t5)

    ticker = str(rec.get("ticker") or "").upper()
    day = _parse_day(rec)
    fp = _event_fingerprint(ticker, day)
    enriched_at = enrich_index.get(fp)
    feed_rec = (enrich_records or {}).get(fp)
    eis_score = _max_eis_score_from_feed_record(feed_rec)
    has_eis = abs(paths["eis_pp"]) > 0.01
    sim_series_key = _chart_series_key(ticker, day)

    rd = rmse_daily if rmse_daily is not None else rmse_base
    rk = rmse_k8 if rmse_k8 is not None else rd
    re = rmse_eis if rmse_eis is not None else rk

    k8_hist_path = k8 if paths["has_k8_path"] else daily
    rmse_raw_no_k8 = rmse_base
    rmse_k8_historic = _path_rmse(k8_hist_path, actual) if k8_hist_path else None
    rmse_raw_eis = _path_rmse(raw_eis_path, actual) if raw_eis_path else None

    has_eis_data = bool(
        rec.get("eis_poly_applied")
        and (paths["has_seq"] or paths["has_knot"] or paths["has_chart"])
        and (
            abs(paths["eis_pp"]) > 0.01
            or rec.get("eis_poly_agg") is not None
            or rec.get("eis_poly_extra_pp") is not None
        )
    )
    in_simulation_tab = bool(
        paths["has_seq"] or paths["has_knot"] or paths["has_chart"]
    )

    return {
        "ticker": ticker,
        "day": day,
        "fingerprint": fp,
        "simulation_series_key": sim_series_key,
        "in_simulation_tab": in_simulation_tab,
        "realized_m5_pp": realized_t5,
        "pred_base_pp": base_t5,
        "cal_factor": levels["cal_factor"],
        "eis_shift_pp": levels["eis_shift_pp"],
        "path_rmse_base": rmse_base,
        "path_rmse_daily": rd,
        "path_rmse_k8": rk,
        "path_rmse_eis": re,
        "path_rmse_raw_no_k8": rmse_raw_no_k8,
        "path_rmse_k8_historic": rmse_k8_historic,
        "path_rmse_raw_eis": rmse_raw_eis,
        "path_rmse_pre_sim": rmse_k8_historic,
        "path_rmse_post_eis": rmse_raw_eis,
        "has_seq_curve": paths["has_seq"],
        "has_chart_bundle": paths["has_chart"],
        "has_knot_snapshots": paths["has_knot"],
        "has_daily_path": paths["has_daily_path"],
        "has_k8_path": paths["has_k8_path"],
        "has_simulation_path": bool(
            paths["has_seq"] or paths["has_knot"] or paths["has_chart"]
        ),
        "enriched_at": enriched_at,
        "eis_score": eis_score,
        "is_enriched": bool(enriched_at or has_eis or rec.get("eis_poly_applied")),
        "has_eis_data": has_eis_data,
        "hit_base": hit_base,
        "hit_daily": hit_daily,
        "hit_k8": hit_k8,
        "hit_eis": hit_eis,
        "hit_raw_eis": hit_raw_eis,
        "n_path_nodes": sum(
            1
            for i in range(len(PATH_OFFSETS))
            if actual[i] is not None and raw[i] is not None and PATH_OFFSETS[i] <= 0
        ),
    }


def _eis_detected(ev: dict[str, Any]) -> bool:
    """True when EIS score is non-zero (positive or negative) or poly shift applied."""
    score = ev.get("eis_score")
    if score is not None:
        try:
            return abs(float(score)) > EIS_ZERO_EPS
        except (TypeError, ValueError):
            pass
    if abs(float(ev.get("eis_shift_pp") or 0)) > 0.01:
        return True
    if ev.get("has_eis_data"):
        return True
    return False


def _price_accuracy_from_rmse(rmse_pp: float | None) -> float | None:
    if rmse_pp is None:
        return None
    return round(max(0.0, min(100.0, 100.0 - float(rmse_pp))), 2)


def _cohort_metrics(events: list[dict[str, Any]], *, use_eis_path: bool = False) -> dict[str, Any]:
    """Aggregate price accuracy (100 − path RMSE) and T−5 sign hit for a cohort."""
    if not events:
        return {
            "n": 0,
            "n_sign_eval": 0,
            "price_accuracy_pct": None,
            "sign_hit_pct": None,
            "avg_path_rmse_pp": None,
        }

    rmse_vals: list[float] = []
    hits = 0
    hit_n = 0
    for ev in events:
        if use_eis_path:
            rk = ev.get("path_rmse_eis") or ev.get("path_rmse_k8") or ev.get("path_rmse_daily")
            hit = ev.get("hit_eis") if ev.get("hit_eis") is not None else ev.get("hit_k8")
        else:
            rk = ev.get("path_rmse_k8") or ev.get("path_rmse_daily") or ev.get("path_rmse_base")
            hit = ev.get("hit_k8") if ev.get("hit_k8") is not None else ev.get("hit_base")
        if rk is not None:
            rmse_vals.append(float(rk))
        if ev.get("realized_m5_pp") is not None:
            hit_n += 1
            if hit:
                hits += 1

    acc_vals = [_price_accuracy_from_rmse(r) for r in rmse_vals]
    acc_vals = [a for a in acc_vals if a is not None]
    price_acc = round(sum(acc_vals) / len(acc_vals), 2) if acc_vals else None
    sign_hit = round(100.0 * hits / hit_n, 2) if hit_n else None
    avg_rmse = round(sum(rmse_vals) / len(rmse_vals), 3) if rmse_vals else None

    return {
        "n": len(events),
        "n_sign_eval": hit_n,
        "price_accuracy_pct": price_acc,
        "sign_hit_pct": sign_hit,
        "avg_path_rmse_pp": avg_rmse,
    }


def _delta_pp(after: float | None, before: float | None) -> float | None:
    if after is None or before is None:
        return None
    return round(after - before, 2)


def _build_eis_magnitude_analysis_safe() -> dict[str, Any]:
    try:
        from prediction.eis_magnitude_analysis import (
            build_eis_magnitude_analysis,
            persist_eis_magnitude_analysis,
        )

        doc = build_eis_magnitude_analysis()
        try:
            persist_eis_magnitude_analysis(doc)
        except OSError:
            pass
        return doc
    except Exception as exc:
        return {"schema_version": 1, "error": str(exc), "n_events_scored": 0}


def _build_eis_cohort_comparison(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Split Simulation-tab opportunities: EIS ≠ 0 vs EIS = 0 or null."""
    with_eis = [e for e in events if _eis_detected(e)]
    without_eis = [e for e in events if not _eis_detected(e)]

    with_metrics = _cohort_metrics(with_eis, use_eis_path=False)
    without_metrics = _cohort_metrics(without_eis, use_eis_path=False)
    with_eis_adjusted = _cohort_metrics(with_eis, use_eis_path=True)

    return {
        "with_eis": with_metrics,
        "without_eis": without_metrics,
        "delta_with_minus_without": {
            "price_accuracy_pp": _delta_pp(
                with_metrics.get("price_accuracy_pct"),
                without_metrics.get("price_accuracy_pct"),
            ),
            "sign_hit_pp": _delta_pp(
                with_metrics.get("sign_hit_pct"),
                without_metrics.get("sign_hit_pct"),
            ),
        },
        "with_eis_after_adjustment": with_eis_adjusted,
        "eis_adjustment_lift": {
            "price_accuracy_pp": _delta_pp(
                with_eis_adjusted.get("price_accuracy_pct"),
                with_metrics.get("price_accuracy_pct"),
            ),
            "sign_hit_pp": _delta_pp(
                with_eis_adjusted.get("sign_hit_pct"),
                with_metrics.get("sign_hit_pct"),
            ),
        },
    }


def _downsample(series: list[dict[str, Any]], max_pts: int) -> list[dict[str, Any]]:
    if len(series) <= max_pts:
        return series
    step = len(series) / max_pts
    out: list[dict[str, Any]] = []
    for i in range(max_pts):
        idx = min(len(series) - 1, int(round(i * step)))
        out.append(series[idx])
    if out[-1] is not series[-1]:
        out.append(series[-1])
    return out


def _accumulate_series(events: list[dict[str, Any]], *, prefix: str = "") -> list[dict[str, Any]]:
    cum_n = 0
    n_daily = n_k8 = n_eis = 0
    sums = {"base": 0.0, "daily": 0.0, "k8": 0.0, "eis": 0.0, "base_d": 0.0}
    hits = {"base": 0, "daily": 0, "k8": 0, "eis": 0, "base_d": 0}
    out: list[dict[str, Any]] = []

    for ev in events:
        cum_n += 1
        sums["base"] += ev["path_rmse_base"]
        if ev.get("hit_base"):
            hits["base"] += 1

        if ev.get("has_daily_path"):
            n_daily += 1
            sums["daily"] += ev["path_rmse_daily"]
            # Same-event base error, so daily-vs-base is compared on the identical
            # subset (avoids mixing the full-set base mean with the daily subset).
            sums["base_d"] += ev["path_rmse_base"]
            if ev.get("hit_daily"):
                hits["daily"] += 1
            if ev.get("hit_base"):
                hits["base_d"] += 1
        if ev.get("has_k8_path"):
            n_k8 += 1
            sums["k8"] += ev["path_rmse_k8"]
            if ev.get("hit_k8"):
                hits["k8"] += 1
        if ev.get("has_k8_path") or abs(ev.get("eis_shift_pp") or 0) > 0.01:
            n_eis += 1
            sums["eis"] += ev["path_rmse_eis"]
            if ev.get("hit_eis"):
                hits["eis"] += 1

        def _avg(total: float, n: int) -> float | None:
            return round(total / n, 3) if n else None

        row: dict[str, Any] = {
            "n": cum_n,
            "day": ev.get("day"),
            "ticker": ev.get("ticker"),
            "sample_kind": "historic",
            "cum_mae_base": round(sums["base"] / cum_n, 3),
            "cum_mae_daily": _avg(sums["daily"], n_daily),
            "cum_mae_k8": _avg(sums["k8"], n_k8),
            "cum_mae_eis": _avg(sums["eis"], n_eis),
            "cum_mae_recalib": _avg(sums["daily"], n_daily),
            "cum_mae_base_on_daily": _avg(sums["base_d"], n_daily),
            "n_with_daily": n_daily,
            "n_with_k8": n_k8,
            "n_with_eis": n_eis,
            "cum_hit_base_pct": round(100.0 * hits["base"] / cum_n, 2),
            "cum_hit_daily_pct": round(100.0 * hits["daily"] / n_daily, 2) if n_daily else None,
            "cum_hit_k8_pct": round(100.0 * hits["k8"] / n_k8, 2) if n_k8 else None,
            "cum_hit_eis_pct": round(100.0 * hits["eis"] / n_eis, 2) if n_eis else None,
            "cum_hit_recalib_pct": round(100.0 * hits["daily"] / n_daily, 2) if n_daily else None,
            "cum_hit_base_on_daily_pct": round(100.0 * hits["base_d"] / n_daily, 2) if n_daily else None,
            "cum_mae_realized": 0.0,
            "cum_hit_realized_pct": 100.0,
        }
        if prefix:
            row["series"] = prefix
        out.append(row)
    return out


def _accumulate_eis_enrichment_series(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cumulative RMSE: raw → +K-8 storico → raw+EIS (Simulation tab, EIS cohort)."""
    cum_n = 0
    n_raw = n_k8 = n_raw_eis = 0
    sum_raw = sum_k8 = sum_raw_eis = 0.0
    hits_raw = hits_k8 = hits_raw_eis = 0
    out: list[dict[str, Any]] = []

    for ev in events:
        cum_n += 1
        raw_rmse = ev.get("path_rmse_raw_no_k8")
        k8_rmse = ev.get("path_rmse_k8_historic")
        raw_eis_rmse = ev.get("path_rmse_raw_eis")

        if raw_rmse is not None:
            n_raw += 1
            sum_raw += raw_rmse
            if ev.get("hit_base"):
                hits_raw += 1

        if k8_rmse is not None:
            n_k8 += 1
            sum_k8 += k8_rmse
            if ev.get("hit_k8") or ev.get("hit_daily"):
                hits_k8 += 1

        if raw_eis_rmse is not None:
            n_raw_eis += 1
            sum_raw_eis += raw_eis_rmse
            if ev.get("hit_raw_eis"):
                hits_raw_eis += 1

        def _avg(total: float, n: int) -> float | None:
            return round(total / n, 3) if n else None

        cum_raw = _avg(sum_raw, n_raw)
        cum_k8 = _avg(sum_k8, n_k8)
        cum_raw_eis = _avg(sum_raw_eis, n_raw_eis)

        out.append(
            {
                "n": cum_n,
                "day": ev.get("day"),
                "ticker": ev.get("ticker"),
                "enriched_at": ev.get("enriched_at"),
                "eis_shift_pp": ev.get("eis_shift_pp"),
                "sample_kind": "eis",
                "cum_mae_raw": cum_raw,
                "cum_mae_k8_historic": cum_k8,
                "cum_mae_raw_eis": cum_raw_eis,
                "cum_mae_pre_eis": cum_k8,
                "cum_mae_eis": cum_raw_eis,
                "cum_hit_raw_pct": round(100.0 * hits_raw / n_raw, 2) if n_raw else None,
                "cum_hit_k8_historic_pct": round(100.0 * hits_k8 / n_k8, 2) if n_k8 else None,
                "cum_hit_raw_eis_pct": round(100.0 * hits_raw_eis / n_raw_eis, 2) if n_raw_eis else None,
                "cum_hit_pre_eis_pct": round(100.0 * hits_k8 / n_k8, 2) if n_k8 else None,
                "cum_hit_eis_pct": round(100.0 * hits_raw_eis / n_raw_eis, 2) if n_raw_eis else None,
            }
        )
    return out


def _load_state() -> dict[str, Any]:
    if not _CURVE_IMPACT_STATE.is_file():
        return {}
    try:
        return json.loads(_CURVE_IMPACT_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(payload: dict[str, Any]) -> None:
    _CURVE_IMPACT_STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _CURVE_IMPACT_STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(_CURVE_IMPACT_STATE)


def build_curve_impact_cumulative(
    *,
    past_pred_path: str | Path | None = None,
    calib_path: str | Path | None = None,
    charts_path: str | Path | None = None,
    max_chart_points: int = MAX_CHART_POINTS,
    auto_enrich: bool = True,
    persist_state: bool = True,
) -> dict[str, Any]:
    cf_default = cal_factor_v4_from_state(Path(calib_path) if calib_path else None)

    if auto_enrich:
        try:
            ensure_past_pred_display_enriched(persist=True)
        except Exception:
            pass

    ai_feed_n = 0
    try:
        from prediction.ai_feed_recalib import get_ai_feed_index

        ai_feed_n = len(get_ai_feed_index())
    except Exception:
        pass

    chart_series = _load_chart_bundle(Path(charts_path) if charts_path else None)
    enrich_records = _load_enrichment_records()
    enrich_index = _load_enrichment_index()

    doc = load_past_pred_document(str(past_pred_path or PAST_CATALYST_PREDICTIONS_JSON))
    rows = rows_map_from_doc(doc)

    events: list[dict[str, Any]] = []
    with_seq = with_chart = with_eis = with_k8_diff = 0
    for rec in rows.values():
        ev = _extract_event(
            rec,
            cf_default=cf_default,
            chart_series=chart_series,
            enrich_index=enrich_index,
            enrich_records=enrich_records,
        )
        if not ev:
            continue
        if ev.get("has_seq_curve"):
            with_seq += 1
        if ev.get("has_chart_bundle"):
            with_chart += 1
        if abs(ev.get("eis_shift_pp") or 0) > 0.01:
            with_eis += 1
        if (
            ev.get("path_rmse_k8") is not None
            and ev.get("path_rmse_daily") is not None
            and abs(ev["path_rmse_k8"] - ev["path_rmse_daily"]) > 0.01
        ):
            with_k8_diff += 1
        events.append(ev)

    events.sort(key=lambda e: (e.get("day") or "", e.get("ticker") or ""))

    sim_events = [e for e in events if e.get("in_simulation_tab")]
    chart_events = sim_events

    full_series = _accumulate_series(chart_events)
    chart_series_out = _downsample(full_series, max_chart_points)

    enriched_events = [e for e in sim_events if e.get("has_eis_data")]
    enriched_events.sort(
        key=lambda e: (e.get("enriched_at") or e.get("day") or "", e.get("ticker") or "")
    )
    enrichment_series = _accumulate_eis_enrichment_series(enriched_events)
    enrichment_chart = _downsample(enrichment_series, max_chart_points)

    last = full_series[-1] if full_series else {}
    last_enr = enrichment_series[-1] if enrichment_series else {}

    prev = _load_state() if persist_state else {}
    sim_fps = {e["fingerprint"] for e in chart_events if e.get("fingerprint")}
    eis_fps = {e["fingerprint"] for e in enriched_events if e.get("fingerprint")}
    prev_sim_fps = set((prev.get("sim_fingerprints") or {}).keys())
    prev_eis_fps = set((prev.get("eis_fingerprints") or {}).keys())
    n_new_sim = len(sim_fps - prev_sim_fps) if prev_sim_fps else len(sim_fps)
    n_new_eis = len(eis_fps - prev_eis_fps) if prev_eis_fps else len(eis_fps)

    result: dict[str, Any] = {
        "metric": "path_rmse_simulation_curves",
        "data_source": "simulation_tab_pipeline",
        "accumulation_mode": "cumulative_chronological",
        "horizon_label": "Pipeline Simulation (tab Simulazione) · passato + live",
        "pipeline_order": "modello grezzo → chiusura giornaliera → +K-8",
        "chart_series_kind": "historic_recalib",
        "enrichment_chart_series_kind": "eis_enrichment",
        "recalib_mode": "simulation_seq_curve",
        "recalib_schedule": list(RECALIB_SCHEDULE),
        "path_offsets": list(PATH_OFFSETS),
        "n_events": len(chart_events),
        "n_events_total": len(events),
        "n_simulation_events": len(sim_events),
        "n_with_seq_curve": with_seq,
        "n_with_chart_bundle": with_chart,
        "n_with_eis_shift": with_eis,
        "n_with_k8_delta": with_k8_diff,
        "n_enriched_events": len(enriched_events),
        "n_with_eis_data": len(enriched_events),
        "n_new_sim_events_since_last": n_new_sim,
        "n_new_eis_events_since_last": n_new_eis,
        "n_chart_bundle_in_snapshot": sum(
            1 for e in chart_events if e.get("has_chart_bundle")
        ),
        "n_with_path_curve": sum(1 for e in events if e.get("n_path_nodes", 0) >= 3),
        "n_with_row_cal_factor": len(events),
        "n_with_display_metadata": len(events),
        "ai_feed_records": ai_feed_n,
        "clinical_feed_records": len(enrich_index),
        "cal_factor_default": round(cf_default, 4),
        "chart_series": chart_series_out,
        "enrichment_chart_series": enrichment_chart,
        "summary": {
            "mae_base_pp": last.get("cum_mae_base"),
            "mae_daily_pp": last.get("cum_mae_daily"),
            "mae_k8_pp": last.get("cum_mae_k8"),
            "mae_eis_pp": last.get("cum_mae_eis"),
            "mae_recalib_pp": last.get("cum_mae_daily"),
            "mae_base_on_daily_pp": last.get("cum_mae_base_on_daily"),
            "n_daily": last.get("n_with_daily"),
            "hit_base_pct": last.get("cum_hit_base_pct"),
            "hit_base_on_daily_pct": last.get("cum_hit_base_on_daily_pct"),
            "hit_daily_pct": last.get("cum_hit_daily_pct"),
            "hit_k8_pct": last.get("cum_hit_k8_pct"),
            "hit_eis_pct": last.get("cum_hit_eis_pct"),
            "hit_recalib_pct": last.get("cum_hit_daily_pct"),
            "mae_realized_pp": last.get("cum_mae_realized"),
            "hit_realized_pct": last.get("cum_hit_realized_pct"),
            "delta_mae_daily_vs_base_pp": (
                round(last["cum_mae_daily"] - last["cum_mae_base"], 3)
                if last.get("cum_mae_daily") is not None and last.get("cum_mae_base") is not None
                else None
            ),
            "delta_mae_k8_vs_daily_pp": (
                round(last["cum_mae_k8"] - last["cum_mae_daily"], 3)
                if last.get("cum_mae_k8") is not None and last.get("cum_mae_daily") is not None
                else None
            ),
            "delta_mae_eis_vs_k8_pp": (
                round(last["cum_mae_eis"] - last["cum_mae_k8"], 3)
                if last.get("cum_mae_eis") is not None and last.get("cum_mae_k8") is not None
                else None
            ),
            "delta_mae_recalib_vs_base_pp": (
                round(last["cum_mae_daily"] - last["cum_mae_base"], 3)
                if last.get("cum_mae_daily") is not None and last.get("cum_mae_base") is not None
                else None
            ),
            # Honest daily-vs-base lift: both means over the same daily subset.
            "delta_mae_daily_vs_base_matched_pp": (
                round(last["cum_mae_daily"] - last["cum_mae_base_on_daily"], 3)
                if last.get("cum_mae_daily") is not None
                and last.get("cum_mae_base_on_daily") is not None
                else None
            ),
            "delta_mae_eis_vs_recalib_pp": (
                round(last["cum_mae_eis"] - last["cum_mae_daily"], 3)
                if last.get("cum_mae_eis") is not None and last.get("cum_mae_daily") is not None
                else None
            ),
        },
        "enrichment_summary": {
            "n_events": len(enriched_events),
            "mae_raw_pp": last_enr.get("cum_mae_raw"),
            "mae_k8_historic_pp": last_enr.get("cum_mae_k8_historic"),
            "mae_raw_eis_pp": last_enr.get("cum_mae_raw_eis"),
            "hit_raw_pct": last_enr.get("cum_hit_raw_pct"),
            "hit_k8_historic_pct": last_enr.get("cum_hit_k8_historic_pct"),
            "hit_raw_eis_pct": last_enr.get("cum_hit_raw_eis_pct"),
            "mae_pre_eis_pp": last_enr.get("cum_mae_k8_historic"),
            "mae_eis_pp": last_enr.get("cum_mae_raw_eis"),
            "hit_pre_eis_pct": last_enr.get("cum_hit_k8_historic_pct"),
            "hit_eis_pct": last_enr.get("cum_hit_raw_eis_pct"),
            "delta_mae_k8_vs_raw_pp": (
                round(last_enr["cum_mae_k8_historic"] - last_enr["cum_mae_raw"], 3)
                if last_enr.get("cum_mae_k8_historic") is not None
                and last_enr.get("cum_mae_raw") is not None
                else None
            ),
            "delta_mae_raw_eis_vs_raw_pp": (
                round(last_enr["cum_mae_raw_eis"] - last_enr["cum_mae_raw"], 3)
                if last_enr.get("cum_mae_raw_eis") is not None
                and last_enr.get("cum_mae_raw") is not None
                else None
            ),
            "delta_mae_eis_vs_pre_eis_pp": (
                round(last_enr["cum_mae_raw_eis"] - last_enr["cum_mae_k8_historic"], 3)
                if last_enr.get("cum_mae_raw_eis") is not None
                and last_enr.get("cum_mae_k8_historic") is not None
                else None
            ),
        },
        "eis_cohort_comparison": _build_eis_cohort_comparison(chart_events),
        "eis_magnitude_analysis": _build_eis_magnitude_analysis_safe(),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }

    if persist_state:
        _save_state(
            {
                "schema_version": STATE_SCHEMA_VERSION,
                "built_at": result["built_at"],
                "n_events": len(chart_events),
                "n_events_total": len(events),
                "n_enriched": len(enriched_events),
                "sim_fingerprints": {
                    e["fingerprint"]: e.get("day") for e in chart_events if e.get("fingerprint")
                },
                "eis_fingerprints": {
                    e["fingerprint"]: e.get("enriched_at") or e.get("day")
                    for e in enriched_events
                    if e.get("fingerprint")
                },
                "last_summary": result["summary"],
                "last_enrichment_summary": result["enrichment_summary"],
                "prev_n_events": prev.get("n_events"),
                "prev_n_eis_events": prev.get("n_enriched"),
            }
        )

    return result


def _scheduled_recalib_path(
    raw: list[float | None],
    actual: list[float | None],
    offsets: tuple[int, ...],
    *,
    schedule: tuple[int, ...] = RECALIB_SCHEDULE,
) -> list[float | None]:
    """Oracle calendar snap (legacy tests / reference)."""
    if len(raw) != len(actual) or len(raw) != len(offsets):
        return raw
    anchors: dict[int, float] = {}
    for i, off in enumerate(offsets):
        if off not in schedule:
            continue
        a = actual[i]
        r = raw[i]
        if a is not None:
            anchors[off] = round(a, 3)
        elif r is not None:
            anchors[off] = round(r, 3)
    if not anchors:
        return list(raw)
    out = _interp_offset_path(offsets, anchors)
    for i, off in enumerate(offsets):
        if off not in schedule and raw[i] is not None and out[i] is None:
            out[i] = raw[i]
    return out


__all__ = [
    "PATH_OFFSETS",
    "RECALIB_SCHEDULE",
    "build_curve_impact_cumulative",
    "_extract_event",
    "_scheduled_recalib_path",
]
