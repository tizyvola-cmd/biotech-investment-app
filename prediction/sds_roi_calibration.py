"""
Calibrate SDS ROI reference profiles from past catalyst cohorts.

Samples up to N tickers per macro-group (SuperNova cl.1, cluster 0, post-CD rise /
neutral / decline), measures **realized % vs T−60** at T−10, T−5, T+4, and
exports median μ + validation stats for the SDS ROI engine.
"""
from __future__ import annotations

import json
import random
import statistics
from datetime import date
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.v5.cohort_prior import realized_pct_vs_m60_at_offset

ROI_STANDARD_OFFSETS: tuple[int, ...] = (-10, -5, 4)
POST_CD_EPS_PP = 0.25
SUPERNova_PEAK_PP = 50.0  # pre-CD peak % vs T−60 proxy for cl.1 membership
DEFAULT_SAMPLE_N = 50
_CALIB_PATH = Path(DATA_DIR) / "sds_roi_calibration.json"


def _row_key(rec: dict[str, Any]) -> str | None:
    tk = str(rec.get("ticker") or "").strip().upper()
    cd = rec.get("completion_date")
    if not tk or cd is None:
        return None
    if isinstance(cd, date):
        cd_s = cd.isoformat()
    else:
        cd_s = str(cd).strip()[:10]
    if not cd_s:
        return None
    return f"{tk}|{cd_s}"


def _mean_vals(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


def _median(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(float(statistics.median(vals)), 2)


def classify_supernova_profile(rec: dict[str, Any]) -> str:
    """SuperNova cl.1 vs cl.0 from pre-CD peak % vs T−60 (ignores post-CD path)."""
    peak_offs = (-30, -10, -7, -5, -3)
    peak_vals = [v for o in peak_offs if (v := realized_pct_vs_m60_at_offset(rec, o)) is not None]
    if peak_vals and max(peak_vals) >= SUPERNova_PEAK_PP:
        return "cluster1"
    return "cluster0"


def classify_past_profile(rec: dict[str, Any]) -> str | None:
    """
    Assign one primary profile: post_rialzo | post_ribasso | post_neutro | cluster1 | cluster0.
    Post-CD supervision overrides when pre/post windows are available.
    """
    pre_offs = (-10, -7, -5)
    post_offs = (4, 7)
    pre_v = [v for o in pre_offs if (v := realized_pct_vs_m60_at_offset(rec, o)) is not None]
    post_v = [v for o in post_offs if (v := realized_pct_vs_m60_at_offset(rec, o)) is not None]
    if len(pre_v) >= 2 and len(post_v) >= 1:
        dlt = _mean_vals(post_v)
        pre_m = _mean_vals(pre_v)
        if dlt is not None and pre_m is not None:
            delta = dlt - pre_m
            if delta > POST_CD_EPS_PP:
                return "post_rialzo"
            if delta < -POST_CD_EPS_PP:
                return "post_ribasso"
            return "post_neutro"

    return classify_supernova_profile(rec)


def _classify_post_cd_profile(rec: dict[str, Any]) -> str | None:
    """Post-CD rise / decline / neutral only."""
    pre_offs = (-10, -7, -5)
    post_offs = (4, 7)
    pre_v = [v for o in pre_offs if (v := realized_pct_vs_m60_at_offset(rec, o)) is not None]
    post_v = [v for o in post_offs if (v := realized_pct_vs_m60_at_offset(rec, o)) is not None]
    if len(pre_v) < 2 or len(post_v) < 1:
        return None
    dlt = _mean_vals(post_v)
    pre_m = _mean_vals(pre_v)
    if dlt is None or pre_m is None:
        return None
    delta = dlt - pre_m
    if delta > POST_CD_EPS_PP:
        return "post_rialzo"
    if delta < -POST_CD_EPS_PP:
        return "post_ribasso"
    return "post_neutro"


def _roi_triple(rec: dict[str, Any]) -> dict[str, float | None]:
    return {
        f"off_{o}": realized_pct_vs_m60_at_offset(rec, o) for o in ROI_STANDARD_OFFSETS
    }


def build_profile_cohorts(
    past_map: dict[str, dict[str, Any]] | None = None,
    *,
    sample_n: int = DEFAULT_SAMPLE_N,
    seed: int = 42,
) -> dict[str, list[dict[str, Any]]]:
    """Group past events by profile; sample up to ``sample_n`` per group."""
    src = past_map if past_map is not None else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    buckets: dict[str, list[dict[str, Any]]] = {
        "cluster1": [],
        "cluster0": [],
        "post_rialzo": [],
        "post_ribasso": [],
        "post_neutro": [],
    }
    for _k, raw in src.items():
        rec = normalize_past_pred_record(raw if isinstance(raw, dict) else {})
        rk = _row_key(rec)
        if not rk:
            continue
        roi = _roi_triple(rec)
        if not any(v is not None for v in roi.values()):
            continue
        base = {
            "key": rk,
            "ticker": str(rec.get("ticker") or "").upper(),
            "completion_date": str(rec.get("completion_date") or "")[:10],
            "roi": roi,
        }
        sn_prof = classify_supernova_profile(rec)
        buckets[sn_prof].append({**base, "profile": sn_prof})
        post_prof = _classify_post_cd_profile(rec)
        if post_prof:
            buckets[post_prof].append({**base, "profile": post_prof})

    rng = random.Random(seed)
    out: dict[str, list[dict[str, Any]]] = {}
    for prof, members in buckets.items():
        if len(members) <= sample_n:
            out[prof] = members
        else:
            out[prof] = rng.sample(members, sample_n)
    return out


def _aggregate_profile_roi(members: list[dict[str, Any]]) -> dict[str, Any]:
    by_off: dict[int, list[float]] = {o: [] for o in ROI_STANDARD_OFFSETS}
    for m in members:
        roi = m.get("roi") or {}
        for o in ROI_STANDARD_OFFSETS:
            v = roi.get(f"off_{o}")
            if v is not None:
                by_off[o].append(float(v))
    medians = {str(o): _median(by_off[o]) for o in ROI_STANDARD_OFFSETS}
    means = {str(o): _mean_vals(by_off[o]) for o in ROI_STANDARD_OFFSETS}
    return {
        "n": len(members),
        "median_pct_vs_m60": medians,
        "mean_pct_vs_m60": means,
    }


def build_sds_roi_calibration(
    *,
    past_map: dict[str, dict[str, Any]] | None = None,
    sample_n: int = DEFAULT_SAMPLE_N,
    seed: int = 42,
) -> dict[str, Any]:
    cohorts = build_profile_cohorts(past_map, sample_n=sample_n, seed=seed)
    profiles: dict[str, Any] = {}
    for prof, members in cohorts.items():
        profiles[prof] = {
            **_aggregate_profile_roi(members),
            "sample": members,
        }
    return {
        "generated_at": date.today().isoformat(),
        "sample_n_cap": sample_n,
        "standard_offsets": list(ROI_STANDARD_OFFSETS),
        "normalization": "pct_vs_t_minus_60_at_calendar_offset",
        "profiles": profiles,
    }


def save_sds_roi_calibration(doc: dict[str, Any] | None = None) -> str:
    doc = doc if doc is not None else build_sds_roi_calibration()
    _CALIB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CALIB_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(_CALIB_PATH)


def load_sds_roi_calibration() -> dict[str, Any]:
    if not _CALIB_PATH.is_file():
        return {}
    try:
        doc = json.loads(_CALIB_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def calibrated_reference_horizons(profile: str) -> dict[int, float | None]:
    """Median realized ROI (% vs T−60) at T−10, T−5, T+4 for a profile."""
    doc = load_sds_roi_calibration()
    prof = (doc.get("profiles") or {}).get(profile) or {}
    med = prof.get("median_pct_vs_m60") or {}
    out: dict[int, float | None] = {}
    for o in ROI_STANDARD_OFFSETS:
        v = med.get(str(o))
        out[o] = float(v) if v is not None else None
    return out
