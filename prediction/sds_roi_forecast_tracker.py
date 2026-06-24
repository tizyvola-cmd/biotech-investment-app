"""
SDS / SuperNova ROI forecast tracking — backtest + forward log.

Backtest: for each retro calibration row with SDS + realized ROI, compare
``estimate_roi_from_sds_correlation`` vs actual (% vs T−60).

Forward: append daily snapshots from SDS cohort (curve_roi horizons); when CD
events mature, fill actual ROI from past_pred and score prediction error.
"""
from __future__ import annotations

import json
import math
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    DATA_DIR,
    PAST_CATALYST_PREDICTIONS_JSON,
    SDS_ROI_BACKTEST_SCORES_JSON,
    SDS_ROI_FORECAST_LOG_JSON,
)
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.sds_roi_calibration import ROI_STANDARD_OFFSETS, realized_pct_vs_m60_at_offset

_HORIZON_KEYS = ("pre_10", "pre_5", "post_4")
_OFF_TO_KEY = {-10: "pre_10", -5: "pre_5", 4: "post_4"}
_SDS_ZONE_KEYS = ("distant", "watch", "candidate", "supernova")


def _sds_zone_key(sds: float) -> str:
    if sds >= 75:
        return "supernova"
    if sds >= 55:
        return "candidate"
    if sds >= 30:
        return "watch"
    return "distant"


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _mae(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(sum(abs(v) for v in vals) / len(vals), 2)


def _median_abs(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(float(statistics.median([abs(v) for v in vals])), 2)


def _horizon_pred(est: dict[str, Any] | None, hk: str) -> float | None:
    if not est:
        return None
    hz = (est.get("horizons") or {}).get(hk) or {}
    return _float_or_none(hz.get("pct_vs_m60"))


def _actual_from_member(member: dict[str, Any], hk: str) -> float | None:
    off = next((o for o, k in _OFF_TO_KEY.items() if k == hk), None)
    if off is None:
        return None
    roi = member.get("roi") or {}
    return _float_or_none(roi.get(f"off_{off}"))


def _actual_from_past_rec(rec: dict[str, Any], hk: str) -> float | None:
    off = next((o for o, k in _OFF_TO_KEY.items() if k == hk), None)
    if off is None:
        return None
    return realized_pct_vs_m60_at_offset(rec, off)


def build_sds_roi_backtest_scores(
    *,
    correlation_doc: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from prediction.sds_roi_correlation import build_sds_roi_correlation, estimate_roi_from_sds_correlation

    doc = correlation_doc if correlation_doc is not None else build_sds_roi_correlation()
    rows = doc.get("calibration_rows") or []
    scored: list[dict[str, Any]] = []
    err_by_hk: dict[str, list[float]] = {k: [] for k in _HORIZON_KEYS}
    err_by_zone: dict[str, dict[str, list[float]]] = {
        z: {k: [] for k in _HORIZON_KEYS} for z in _SDS_ZONE_KEYS
    }

    for member in rows:
        sds = _float_or_none(member.get("sds"))
        if sds is None:
            continue
        profile = member.get("profile")
        est = estimate_roi_from_sds_correlation(sds, profile=profile if isinstance(profile, str) else None)
        row_out: dict[str, Any] = {
            "key": member.get("key"),
            "ticker": member.get("ticker"),
            "completion_date": member.get("completion_date"),
            "profile": profile,
            "sds": round(sds, 1),
            "sds_zone": member.get("sds_zone"),
            "predicted": {},
            "actual": {},
            "error_pp": {},
        }
        has_any = False
        for hk in _HORIZON_KEYS:
            pred = _horizon_pred(est, hk)
            act = _actual_from_member(member, hk)
            row_out["predicted"][hk] = pred
            row_out["actual"][hk] = act
            if pred is not None and act is not None:
                err = round(pred - act, 2)
                row_out["error_pp"][hk] = err
                err_by_hk[hk].append(err)
                err_by_zone[_sds_zone_key(sds)][hk].append(err)
                has_any = True
        if has_any:
            scored.append(row_out)

    pooled = doc.get("pooled_extended") or {}
    corr_meta = pooled.get("correlation") or {}

    summary = {
        hk: {
            "n": len(err_by_hk[hk]),
            "mae_pp": _mae([abs(e) for e in err_by_hk[hk]]),
            "median_abs_err_pp": _median_abs(err_by_hk[hk]),
            "mean_signed_err_pp": round(sum(err_by_hk[hk]) / len(err_by_hk[hk]), 2) if err_by_hk[hk] else None,
            "correlation_r": (corr_meta.get(hk) or {}).get("r"),
        }
        for hk in _HORIZON_KEYS
    }

    summary_by_sds_zone = {
        zone: {
            hk: {
                "n": len(err_by_zone[zone][hk]),
                "mae_pp": _mae([abs(e) for e in err_by_zone[zone][hk]]),
                "mean_signed_err_pp": round(
                    sum(err_by_zone[zone][hk]) / len(err_by_zone[zone][hk]), 2
                )
                if err_by_zone[zone][hk]
                else None,
            }
            for hk in _HORIZON_KEYS
        }
        for zone in _SDS_ZONE_KEYS
    }

    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "methodology": (
            "Retro backtest: point-in-time SDS on past catalyst controls vs "
            "anchor-blended ROI estimate (post_neutro → cluster1). "
            "Actual ROI = % vs T−60 at calendar knots T−10, T−5, T+4."
        ),
        "n_calibration_rows": len(rows),
        "n_scored": len(scored),
        "summary_by_horizon": summary,
        "summary_by_sds_zone": summary_by_sds_zone,
        "sample_rows": scored[:40],
    }


def save_sds_roi_backtest_scores(doc: dict[str, Any] | None = None) -> str:
    doc = doc if doc is not None else build_sds_roi_backtest_scores()
    Path(SDS_ROI_BACKTEST_SCORES_JSON).parent.mkdir(parents=True, exist_ok=True)
    Path(SDS_ROI_BACKTEST_SCORES_JSON).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return SDS_ROI_BACKTEST_SCORES_JSON


def load_sds_roi_backtest_scores() -> dict[str, Any]:
    p = Path(SDS_ROI_BACKTEST_SCORES_JSON)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _load_forecast_log() -> dict[str, Any]:
    p = Path(SDS_ROI_FORECAST_LOG_JSON)
    if not p.is_file():
        return {"version": 1, "updated_at": None, "events": {}}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            return {"version": 1, "updated_at": None, "events": {}}
        doc.setdefault("events", {})
        return doc
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "updated_at": None, "events": {}}


def _save_forecast_log(doc: dict[str, Any]) -> str:
    Path(SDS_ROI_FORECAST_LOG_JSON).parent.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    Path(SDS_ROI_FORECAST_LOG_JSON).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return SDS_ROI_FORECAST_LOG_JSON


def _event_key(ticker: str, cd: str) -> str:
    return f"{ticker.strip().upper()}|{cd.strip()[:10]}"


def _parse_iso(d: str | None) -> date | None:
    if not d:
        return None
    try:
        return date.fromisoformat(str(d)[:10])
    except ValueError:
        return None


def _horizon_values(src: dict[str, Any] | None) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for hk in _HORIZON_KEYS:
        hz = (src or {}).get(hk) or {}
        out[hk] = _float_or_none(hz.get("pct_vs_m60"))
    return out


def _predicted_blend_from_row(row: dict[str, Any]) -> dict[str, float | None]:
    """μ SDS blend at calendar knots (horizons_curve preferred over correlation override)."""
    blend = row.get("curve_roi") or {}
    src = blend.get("horizons_curve") or blend.get("horizons") or {}
    return _horizon_values(src)


def _predicted_pred_from_row(row: dict[str, Any]) -> dict[str, float | None]:
    """Raw Prediction + Recalibration curve at T−10 / T−5 / T+4."""
    blend = row.get("curve_roi") or {}
    return _horizon_values(blend.get("horizons_pred"))


def _predicted_from_sds_row(row: dict[str, Any]) -> dict[str, float | None]:
    """Legacy alias — SDS blend estimate."""
    return _predicted_blend_from_row(row)


def _sign_hit(pred: float | None, actual: float | None, *, flat_pp: float = 0.35) -> bool | None:
    if pred is None or actual is None:
        return None
    def _sign(v: float) -> int:
        if v > flat_pp:
            return 1
        if v < -flat_pp:
            return -1
        return 0

    ps, as_ = _sign(pred), _sign(actual)
    if ps == 0 and as_ == 0:
        return True
    if ps == 0 or as_ == 0:
        return False
    return ps == as_


def _blend_eval_summary(
    scored_events: list[dict[str, Any]],
) -> dict[str, Any]:
    by_hk: dict[str, dict[str, Any]] = {}
    for hk in _HORIZON_KEYS:
        pred_errs: list[float] = []
        blend_errs: list[float] = []
        blend_wins = 0
        comparable = 0
        hit_pred_n = 0
        hit_blend_n = 0
        hit_pred_total = 0
        hit_blend_total = 0
        for ev in scored_events:
            ep = (ev.get("error_pp_pred") or {}).get(hk)
            eb = (ev.get("error_pp_blend") or {}).get(hk)
            if ep is not None:
                pred_errs.append(abs(ep))
            if eb is not None:
                blend_errs.append(abs(eb))
            if ep is not None and eb is not None:
                comparable += 1
                if abs(eb) < abs(ep) - 0.01:
                    blend_wins += 1
            hp = (ev.get("hit_pred") or {}).get(hk)
            hb = (ev.get("hit_blend") or {}).get(hk)
            if hp is not None:
                hit_pred_total += 1
                if hp:
                    hit_pred_n += 1
            if hb is not None:
                hit_blend_total += 1
                if hb:
                    hit_blend_n += 1
        by_hk[hk] = {
            "n": max(len(blend_errs), len(pred_errs)),
            "n_comparable": comparable,
            "mae_pred_pp": _mae(pred_errs),
            "mae_blend_pp": _mae(blend_errs),
            "blend_better_n": blend_wins,
            "blend_better_pct": round(100.0 * blend_wins / comparable, 1) if comparable else None,
            "hit_rate_pred": round(100.0 * hit_pred_n / hit_pred_total, 1) if hit_pred_total else None,
            "hit_rate_blend": round(100.0 * hit_blend_n / hit_blend_total, 1) if hit_blend_total else None,
            "hit_n_pred": hit_pred_total,
            "hit_n_blend": hit_blend_total,
        }
    return {"by_horizon": by_hk, "methodology": (
        "Compare Prediction+Recalibration (horizons_pred) vs μ SDS blend (horizons_curve) "
        "at T−10/T−5/T+4. Matured events scored CD+14d vs past_pred realized ROI."
    )}


def append_sds_roi_forecasts(
    sds_snapshot: dict[str, Any],
    *,
    past_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Append today's SDS ROI predictions; score matured events vs past_pred."""
    today = date.today().isoformat()
    log = _load_forecast_log()
    events: dict[str, Any] = log.setdefault("events", {})
    src_past = past_map if past_map is not None else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)

    for row in sds_snapshot.get("rows") or []:
        ticker = str(row.get("ticker") or "").strip().upper()
        cd = str(row.get("completion_date") or row.get("cd") or "")[:10]
        if not ticker or not cd:
            continue
        key = _event_key(ticker, cd)
        predicted_blend = _predicted_blend_from_row(row)
        predicted_pred = _predicted_pred_from_row(row)
        if not any(v is not None for v in predicted_blend.values()) and not any(
            v is not None for v in predicted_pred.values()
        ):
            continue

        snap = {
            "captured_at": today,
            "sds": _float_or_none(row.get("sds")),
            "sds_zone": row.get("sds_zone") or row.get("zone"),
            "predicted": predicted_blend,
            "predicted_blend": predicted_blend,
            "predicted_pred": predicted_pred,
            "fit_pct": _float_or_none((row.get("curve_roi") or {}).get("best_fit_pct")),
            "best_profile": (row.get("curve_roi") or {}).get("best_profile"),
        }
        ev = events.get(key) or {
            "key": key,
            "ticker": ticker,
            "completion_date": cd,
            "snapshots": [],
            "actual": {},
            "scored_at": None,
            "error_pp": {},
            "error_pp_blend": {},
            "error_pp_pred": {},
            "hit_blend": {},
            "hit_pred": {},
        }
        snaps: list[dict[str, Any]] = ev.setdefault("snapshots", [])
        if not snaps or snaps[-1].get("captured_at") != today:
            snaps.append(snap)
        events[key] = ev

    # Score matured: CD + 14d passed and record in past_pred
    mature_cutoff = date.today() - timedelta(days=14)
    forward_errors: dict[str, list[float]] = {k: [] for k in _HORIZON_KEYS}
    n_matured = 0
    scored_for_eval: list[dict[str, Any]] = []

    for key, ev in events.items():
        cd_d = _parse_iso(ev.get("completion_date"))
        if cd_d is None or cd_d > mature_cutoff:
            continue
        rec_raw = src_past.get(key)
        if not rec_raw:
            continue
        rec = normalize_past_pred_record(dict(rec_raw))
        actual: dict[str, float | None] = {}
        for hk in _HORIZON_KEYS:
            actual[hk] = _actual_from_past_rec(rec, hk)
        if not any(v is not None for v in actual.values()):
            continue

        latest = (ev.get("snapshots") or [])[-1] if ev.get("snapshots") else {}
        blend = latest.get("predicted_blend") or latest.get("predicted") or {}
        pred_only = latest.get("predicted_pred") or {}
        err: dict[str, float | None] = {}
        err_blend: dict[str, float | None] = {}
        err_pred: dict[str, float | None] = {}
        hit_blend: dict[str, bool | None] = {}
        hit_pred: dict[str, bool | None] = {}
        for hk in _HORIZON_KEYS:
            pb = _float_or_none(blend.get(hk))
            pp = _float_or_none(pred_only.get(hk))
            a = actual.get(hk)
            if pb is not None and a is not None:
                e = round(pb - a, 2)
                err_blend[hk] = e
                err[hk] = e
                forward_errors[hk].append(e)
                hit_blend[hk] = _sign_hit(pb, a)
            if pp is not None and a is not None:
                err_pred[hk] = round(pp - a, 2)
                hit_pred[hk] = _sign_hit(pp, a)
        ev["actual"] = actual
        ev["error_pp"] = err
        ev["error_pp_blend"] = err_blend
        ev["error_pp_pred"] = err_pred
        ev["hit_blend"] = hit_blend
        ev["hit_pred"] = hit_pred
        ev["scored_at"] = today
        n_matured += 1
        scored_for_eval.append(ev)

    log["forward_summary"] = {
        "n_tracked": len(events),
        "n_matured_scored": n_matured,
        "n_pending": len(events) - n_matured,
        "by_horizon": {
            hk: {
                "n": len(forward_errors[hk]),
                "mae_pp": _mae([abs(e) for e in forward_errors[hk]]),
                "median_abs_err_pp": _median_abs(forward_errors[hk]),
            }
            for hk in _HORIZON_KEYS
        },
        "blend_vs_pred": _blend_eval_summary(scored_for_eval),
    }
    _save_forecast_log(log)
    return log


def load_sds_roi_forecast_log() -> dict[str, Any]:
    return _load_forecast_log()
