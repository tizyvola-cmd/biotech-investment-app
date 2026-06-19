"""
SDS ↔ ROI correlation calibration.

For each control group (SuperNova cl.1, cluster 0, post-CD rialzo / neutro / ribasso —
max 50 random each) and study cohort members:
  1. Compute SDS (clusters A–E) — retro proxy on past events, live on current cohort.
  2. Measure realized ROI (% vs T−60) at T−10, T−5, T+4.
  3. Build profile anchors + quintile bins + linear correlation SDS → ROI per horizon.
  4. Estimate ROI for study tickers from live SDS via anchor interpolation (neutro → cl.1).
"""
from __future__ import annotations

import json
import math
import statistics
from datetime import date, datetime
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON
from past_pred_io import load_past_pred_map, normalize_past_pred_record
from prediction.sds_roi_calibration import (
    ROI_STANDARD_OFFSETS,
    build_profile_cohorts,
    load_sds_roi_calibration,
)
from prediction.supernova_score import SdsTickerInput, compute_sds

_CORR_PATH = Path(DATA_DIR) / "sds_roi_correlation.json"
# All calibration profiles (50 random samples each from build_profile_cohorts).
_CALIBRATION_PROFILES = (
    "cluster1",
    "cluster0",
    "post_rialzo",
    "post_ribasso",
    "post_neutro",
)
_POST_CD_PROFILES = ("post_rialzo", "post_ribasso", "post_neutro")
_HORIZON_KEYS = ("pre_10", "pre_5", "post_4")
_OFF_TO_KEY = {-10: "pre_10", -5: "pre_5", 4: "post_4"}

# SDS zone floors — aligned with SupernovaDistanceScore / supernova_score zones.
_SDS_WATCH_FLOOR = 30.0
_SDS_SUPERNOVA_FLOOR = 75.0
# Anchor keys for live-SDS interpolation (low → high ROI expectation).
_ANCHOR_LOW = "post_neutro"
_ANCHOR_HIGH = "cluster1"


def _float_or_none(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


_KNOT_CLOSES: tuple[tuple[int, tuple[str, ...]], ...] = (
    (-60, ("close_m60_cal", "close_m60")),
    (-30, ("close_m30_cal", "close_m30")),
    (-10, ("close_m10_cal", "close_m10")),
    (-7, ("close_m7",)),
    (-5, ("close_m5",)),
    (-3, ("close_m3",)),
    (0, ("price_at_cd",)),
)


def _lookup_close(rec: dict[str, Any], off: int) -> float | None:
    key_map = dict(_KNOT_CLOSES)
    for key in key_map.get(off, ()):
        v = _float_or_none(rec.get(key))
        if v is not None and v > 0:
            return v
    return None


def _expand_knot_series(rec: dict[str, Any], n_points: int = 45) -> tuple[list[float], list[float]]:
    """Synthetic close/volume series from past_pred calendar knots at decision time."""
    knots: list[tuple[int, float]] = []
    for off, _keys in _KNOT_CLOSES:
        px = _lookup_close(rec, off)
        if px is not None:
            knots.append((off, px))
    if len(knots) < 2:
        return [], []
    knots.sort(key=lambda x: x[0])
    min_off, max_off = knots[0][0], knots[-1][0]

    def price_at(off: float) -> float:
        for i in range(len(knots) - 1):
            o0, p0 = knots[i]
            o1, p1 = knots[i + 1]
            if o0 <= off <= o1:
                if o1 == o0:
                    return p0
                t = (off - o0) / (o1 - o0)
                return p0 + t * (p1 - p0)
        return knots[-1][1] if off >= knots[-1][0] else knots[0][1]

    closes = [round(price_at(min_off + (max_off - min_off) * i / (n_points - 1)), 4) for i in range(n_points)]
    vols = [1_000_000.0] * n_points
    return closes, vols


def _cluster_a_from_past(rec: dict[str, Any]) -> dict[str, Any]:
    """Trial metadata: cached ctgov + fields frozen in past_pred."""
    tk = str(rec.get("ticker") or "").strip().upper()
    ca: dict[str, Any] = {}
    try:
        from prediction.sds_cluster_a_collector import load_cached_cluster_a

        ca = load_cached_cluster_a(tk) or {}
    except Exception:
        pass
    if not ca.get("phase") and rec.get("phase"):
        ca["phase"] = rec.get("phase")
    return ca


def build_retro_sds_input_from_past(rec: dict[str, Any]) -> SdsTickerInput | None:
    """
    Point-in-time SDS at T−10 before CD.

    Uses calendar closes + model fields frozen in ``past_pred`` (no live FMP B/D).
    Cluster A from ctgov cache (trial metadata); C/E from price path + timing at T−10.
    """
    tk = str(rec.get("ticker") or "").strip().upper()
    if not tk:
        return None
    closes, vols = _expand_knot_series(rec)
    if len(closes) < 20:
        return None

    ca = _cluster_a_from_past(rec)
    phase_val = ca.get("phase") or rec.get("phase")

    phase_prob: float | None = None
    try:
        from prediction.phase_pos import get_phase_pos
        from prediction.supernova_score import _phase_num_from_text

        ph_num = _phase_num_from_text(phase_val)
        if ph_num is not None:
            phase_prob = get_phase_pos(ph_num)
    except Exception:
        phase_prob = None

    pred5 = _float_or_none(rec.get("model_dm5_pct") or rec.get("model_d5_pct"))
    aff = _float_or_none(rec.get("affidabilita_calib") or rec.get("affidabilita"))
    conf = aff / 100.0 if aff is not None else None
    vol_ratio = _float_or_none(rec.get("vol_ratio"))

    return SdsTickerInput(
        ticker=tk,
        closes=closes,
        volumes=vols,
        xbi_closes=[],
        days_to_cd=10,
        phase=phase_val,
        primary_outcome=ca.get("primary_outcome") or rec.get("primary_outcome"),
        primary_outcomes=list(ca.get("primary_outcomes") or []),
        trial_design=ca.get("trial_design"),
        study_description=ca.get("study_description") or ca.get("ctgov_brief_title"),
        indication=ca.get("indication") or rec.get("indication"),
        condition=ca.get("indication"),
        intervention_name=ca.get("interventions") or rec.get("drug"),
        unmet_need=_float_or_none(ca.get("unmet_need_score")),
        market_size=_float_or_none(ca.get("market_size_score")),
        first_in_class=ca.get("first_in_class") if isinstance(ca.get("first_in_class"), bool) else None,
        approved_drugs_count=int(ca["approved_drugs_count"]) if ca.get("approved_drugs_count") is not None else None,
        pipeline_value_estimate=_float_or_none(ca.get("pipeline_value_estimate")),
        catalyst_types_90d=["clinical_readout"],
        volume_ratio_5d=vol_ratio,
        pred5_live=pred5,
        confidence_score=conf,
        phase_probability=phase_prob,
        cluster_b_meta={},
        cluster_d_meta={},
        cd_date=str(rec.get("completion_date") or "")[:10] or None,
    )


def retro_sds_for_past_record(rec: dict[str, Any]) -> dict[str, Any] | None:
    inp = build_retro_sds_input_from_past(rec)
    if inp is None:
        return None
    result = compute_sds(inp)
    return {
        "sds": round(result.sds, 1),
        "zone_label": result.zone_label,
        "cluster_scores": dict(result.cluster_scores or {}),
        "retro_mode": "point_in_time_t10",
        "missing_data_pct": result.missing_data_pct,
    }


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 4:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den_x = math.sqrt(sum((x - mx) ** 2 for x in xs))
    den_y = math.sqrt(sum((y - my) ** 2 for y in ys))
    if den_x <= 0 or den_y <= 0:
        return None
    return round(num / (den_x * den_y), 3)


def _quintile_edges(values: list[float]) -> list[float]:
    if len(values) < 5:
        return []
    sorted_v = sorted(values)
    n = len(sorted_v)
    edges: list[float] = [sorted_v[0]]
    for q in (1, 2, 3, 4):
        idx = min(n - 1, int(round(q * n / 5)) - 1)
        edges.append(sorted_v[idx])
    edges.append(sorted_v[-1])
    return edges


def _bin_index(sds: float, edges: list[float]) -> int:
    if not edges:
        return 0
    for i in range(len(edges) - 1):
        if sds <= edges[i + 1]:
            return i
    return len(edges) - 2


def _median(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(float(statistics.median(vals)), 2)


def _enrich_calibration_with_sds(
    cohorts: dict[str, list[dict[str, Any]]],
    past_map: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attach retro SDS to sampled calibration members."""
    by_key = {}
    for raw in past_map.values():
        rec = normalize_past_pred_record(raw if isinstance(raw, dict) else {})
        tk = str(rec.get("ticker") or "").upper()
        cd = str(rec.get("completion_date") or "")[:10]
        if tk and cd:
            by_key[f"{tk}|{cd}"] = rec

    out: list[dict[str, Any]] = []
    for prof, members in cohorts.items():
        for m in members:
            rec = by_key.get(m.get("key") or "")
            sds_doc = retro_sds_for_past_record(rec) if rec else None
            row = {**m, "profile": prof}
            if sds_doc:
                row["sds"] = sds_doc["sds"]
                row["sds_zone"] = sds_doc.get("zone_label")
                row["cluster_scores"] = sds_doc.get("cluster_scores")
            out.append(row)
    return out


def _build_bins(members: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: list[tuple[float, dict[str, float | None]]] = []
    for m in members:
        sds = m.get("sds")
        if sds is None:
            continue
        roi = m.get("roi") or {}
        horizons = {
            _OFF_TO_KEY[o]: _float_or_none(roi.get(f"off_{o}")) for o in ROI_STANDARD_OFFSETS
        }
        if not any(v is not None for v in horizons.values()):
            continue
        pairs.append((float(sds), horizons))

    if not pairs:
        return {"n": 0, "bins": [], "correlation": {}, "quintile_edges": []}

    sds_vals = [p[0] for p in pairs]
    edges = _quintile_edges(sds_vals)
    bins: list[dict[str, Any]] = []
    n_bins = max(len(edges) - 1, 1) if edges else 5
    for bi in range(n_bins):
        if edges:
            lo, hi = edges[bi], edges[bi + 1]
            subset = [p for p in pairs if lo <= p[0] <= hi or (bi == n_bins - 1 and p[0] >= lo)]
        else:
            lo, hi = min(sds_vals), max(sds_vals)
            subset = pairs
        if not subset:
            continue
        medians = {k: _median([p[1].get(k) for p in subset if p[1].get(k) is not None]) for k in _HORIZON_KEYS}
        bins.append(
            {
                "bin": bi + 1,
                "sds_min": round(lo, 1),
                "sds_max": round(hi, 1),
                "n": len(subset),
                "median_roi_pct_vs_m60": medians,
            }
        )

    correlation: dict[str, Any] = {}
    for hk, off in [("pre_10", -10), ("pre_5", -5), ("post_4", 4)]:
        xs, ys = [], []
        for sds, hz in pairs:
            y = hz.get(hk)
            if y is not None:
                xs.append(sds)
                ys.append(float(y))
        r = _pearson(xs, ys)
        if r is not None and len(xs) >= 4:
            mx = sum(xs) / len(xs)
            my = sum(ys) / len(ys)
            num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
            den = sum((x - mx) ** 2 for x in xs)
            slope = round(num / den, 4) if den else 0.0
            intercept = round(my - slope * mx, 2)
        else:
            slope, intercept = None, None
        correlation[hk] = {"r": r, "slope_pp_per_sds": slope, "intercept_pp": intercept, "n": len(xs)}

    return {
        "n": len(pairs),
        "quintile_edges": edges,
        "bins": bins,
        "correlation": correlation,
    }


def _build_profile_anchors(members: list[dict[str, Any]]) -> dict[str, Any]:
    """Median retro SDS + median realized ROI per horizon for one profile cohort."""
    sds_vals: list[float] = []
    by_hk: dict[str, list[float]] = {k: [] for k in _HORIZON_KEYS}
    for m in members:
        sds = m.get("sds")
        if sds is None:
            continue
        sds_vals.append(float(sds))
        roi = m.get("roi") or {}
        for o in ROI_STANDARD_OFFSETS:
            hk = _OFF_TO_KEY[o]
            v = _float_or_none(roi.get(f"off_{o}"))
            if v is not None:
                by_hk[hk].append(float(v))
    if not sds_vals:
        return {"n": 0, "median_sds": None, "median_roi_pct_vs_m60": {}}
    return {
        "n": len(sds_vals),
        "median_sds": _median(sds_vals),
        "median_roi_pct_vs_m60": {k: _median(vs) for k, vs in by_hk.items()},
    }


def _calibration_profile_roi_fallback(profile: str) -> dict[str, float | None] | None:
    """Median ROI from sds_roi_calibration.json when correlation cohort lacks SDS."""
    doc = load_sds_roi_calibration()
    prof = (doc.get("profiles") or {}).get(profile) or {}
    med = prof.get("median_pct_vs_m60") or {}
    if not med:
        return None
    out: dict[str, float | None] = {}
    for o in ROI_STANDARD_OFFSETS:
        hk = _OFF_TO_KEY[o]
        v = med.get(str(o))
        out[hk] = float(v) if v is not None else None
    return out


def _sds_supernova_weight(sds: float) -> float:
    """Map live SDS to [0, 1] between WATCH (30) and SUPERNOVA (75) zones."""
    if sds <= _SDS_WATCH_FLOOR:
        return 0.0
    if sds >= _SDS_SUPERNOVA_FLOOR:
        return 1.0
    return (sds - _SDS_WATCH_FLOOR) / (_SDS_SUPERNOVA_FLOOR - _SDS_WATCH_FLOOR)


def _lerp(a: float | None, b: float | None, t: float) -> float | None:
    if a is None or b is None:
        return None
    return round(a + t * (b - a), 2)


def _dedupe_by_event_key(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        key = str(row.get("key") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def _estimate_from_profile_anchors(
    sds: float,
    anchors: dict[str, Any],
    *,
    profile: str | None = None,
) -> dict[str, dict[str, Any]] | None:
    """
    Interpolate ROI between post_neutro (floor) and cluster1 SuperNova (ceiling),
    weighted by live SDS zone. Optional tilt toward curve-fit post-CD profile anchor.
    """
    low = anchors.get(_ANCHOR_LOW) or {}
    high = anchors.get(_ANCHOR_HIGH) or {}
    if not low.get("median_roi_pct_vs_m60") and not high.get("median_roi_pct_vs_m60"):
        low_med = _calibration_profile_roi_fallback(_ANCHOR_LOW)
        high_med = _calibration_profile_roi_fallback(_ANCHOR_HIGH)
        if low_med or high_med:
            low = {"median_roi_pct_vs_m60": low_med or {}}
            high = {"median_roi_pct_vs_m60": high_med or {}}
        else:
            return None

    w = _sds_supernova_weight(sds)
    prof_anchor = anchors.get(profile or "") if profile in _CALIBRATION_PROFILES else None
    prof_med = (prof_anchor or {}).get("median_roi_pct_vs_m60") or {}

    horizons: dict[str, dict[str, Any]] = {}
    for hk in _HORIZON_KEYS:
        lo = (low.get("median_roi_pct_vs_m60") or {}).get(hk)
        hi = (high.get("median_roi_pct_vs_m60") or {}).get(hk)
        est = _lerp(lo, hi, w)
        if est is None:
            continue
        if profile in _POST_CD_PROFILES and hk in prof_med and prof_med[hk] is not None:
            est = round(0.55 * est + 0.45 * float(prof_med[hk]), 2)
        horizons[hk] = {
            "pct_vs_m60": est,
            "source": "anchor_blend",
            "weight_supernova": round(w, 3),
            "anchor_low": _ANCHOR_LOW,
            "anchor_high": _ANCHOR_HIGH,
        }
    return horizons or None


def build_sds_roi_correlation(
    *,
    past_map: dict[str, dict[str, Any]] | None = None,
    sample_n: int = 50,
    seed: int = 42,
) -> dict[str, Any]:
    src = past_map if past_map is not None else load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
    cohorts = build_profile_cohorts(src, sample_n=sample_n, seed=seed)
    enriched = _enrich_calibration_with_sds(cohorts, src)

    by_profile: dict[str, list[dict[str, Any]]] = {p: [] for p in _CALIBRATION_PROFILES}
    for row in enriched:
        prof = row.get("profile")
        if prof in by_profile:
            by_profile[prof].append(row)

    profiles = {prof: _build_bins(members) for prof, members in by_profile.items()}
    profile_anchors = {prof: _build_profile_anchors(members) for prof, members in by_profile.items()}

    # Fill anchor ROI from calibration medians when retro SDS cohort is empty.
    for prof in _CALIBRATION_PROFILES:
        pa = profile_anchors.get(prof) or {}
        if pa.get("median_roi_pct_vs_m60"):
            continue
        fallback = _calibration_profile_roi_fallback(prof)
        if fallback:
            profile_anchors[prof] = {
                **pa,
                "median_roi_pct_vs_m60": fallback,
                "n": pa.get("n") or 0,
                "source": "calibration_median",
            }

    pooled_post_cd = _build_bins([r for r in enriched if r.get("profile") in _POST_CD_PROFILES])
    pooled_extended = _build_bins(
        _dedupe_by_event_key([r for r in enriched if r.get("profile") in _CALIBRATION_PROFILES]),
    )

    return {
        "generated_at": date.today().isoformat(),
        "methodology": (
            "Point-in-time SDS at T−10 on controls (calendar closes + past_pred, no live FMP). "
            "Profile anchors: post_neutro (50 random) → cluster1 SuperNova (50 random) plus "
            "post_rialzo/ribasso/cluster0. Live study SDS interpolates ROI between neutro and "
            "SuperNova anchors by SDS zone (30=WATCH … 75=SUPERNOVA)."
        ),
        "sample_n_cap": sample_n,
        "standard_offsets": list(ROI_STANDARD_OFFSETS),
        "anchor_low": _ANCHOR_LOW,
        "anchor_high": _ANCHOR_HIGH,
        "sds_watch_floor": _SDS_WATCH_FLOOR,
        "sds_supernova_floor": _SDS_SUPERNOVA_FLOOR,
        "profiles": profiles,
        "profile_anchors": profile_anchors,
        "pooled_post_cd": pooled_post_cd,
        "pooled_extended": pooled_extended,
        "calibration_rows": enriched,
    }


def save_sds_roi_correlation(doc: dict[str, Any] | None = None) -> str:
    doc = doc if doc is not None else build_sds_roi_correlation()
    try:
        from prediction.sds_roi_forecast_tracker import build_sds_roi_backtest_scores, save_sds_roi_backtest_scores

        save_sds_roi_backtest_scores(build_sds_roi_backtest_scores(correlation_doc=doc))
    except Exception:
        pass
    _CORR_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Trim heavy sample from persisted copy
    slim = {**doc}
    slim.pop("calibration_rows", None)
    _CORR_PATH.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(_CORR_PATH)


def load_sds_roi_correlation() -> dict[str, Any]:
    if not _CORR_PATH.is_file():
        return {}
    try:
        doc = json.loads(_CORR_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def estimate_roi_from_sds_correlation(
    sds: float | None,
    *,
    profile: str | None = None,
) -> dict[str, Any] | None:
    """
    Estimate ROI (% vs T−60) at T−10, T−5, T+4 from SDS correlation scale.

    Primary: anchor blend post_neutro → cluster1 by live SDS zone.
    Fallback: profile-specific quintiles, then pooled_extended regression.
    """
    if sds is None or not math.isfinite(float(sds)):
        return None
    doc = load_sds_roi_correlation()
    if not doc:
        return None

    sds_f = float(sds)
    anchors = doc.get("profile_anchors") or {}
    anchor_horizons = _estimate_from_profile_anchors(sds_f, anchors, profile=profile)

    if anchor_horizons:
        return {
            "horizons": anchor_horizons,
            "profile_used": profile if profile in _CALIBRATION_PROFILES else "anchor_neutro_cluster1",
            "sds_input": round(sds_f, 1),
        }

    block = (doc.get("profiles") or {}).get(profile or "") if profile in _CALIBRATION_PROFILES else None
    if not block or not block.get("bins"):
        block = doc.get("pooled_extended") or doc.get("pooled_post_cd") or {}
    bins = block.get("bins") or []
    edges = block.get("quintile_edges") or []
    corr = block.get("correlation") or {}
    if not bins and not corr:
        return None

    horizons: dict[str, dict[str, float | None]] = {}

    if bins and edges and sds_f <= (edges[-1] if edges else sds_f):
        bi = _bin_index(sds_f, edges)
        bi = min(max(bi, 0), len(bins) - 1)
        med = (bins[bi].get("median_roi_pct_vs_m60") or {}) if bi >= 0 else {}
        for hk in _HORIZON_KEYS:
            v = med.get(hk)
            if v is not None:
                horizons[hk] = {"pct_vs_m60": v, "source": "quintile_median", "bin": bins[bi].get("bin")}

    for hk in _HORIZON_KEYS:
        if hk in horizons:
            continue
        reg = corr.get(hk) or {}
        slope = reg.get("slope_pp_per_sds")
        intercept = reg.get("intercept_pp")
        if slope is not None and intercept is not None:
            est = round(float(slope) * sds_f + float(intercept), 2)
            horizons[hk] = {"pct_vs_m60": est, "source": "linear_regression", "r": reg.get("r")}

    if not horizons:
        return None

    return {
        "horizons": horizons,
        "profile_used": profile if profile in _CALIBRATION_PROFILES else "pooled_extended",
        "sds_input": round(sds_f, 1),
    }
