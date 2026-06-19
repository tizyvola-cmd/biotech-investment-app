"""
Multi-curve ROI blend for SDS cohort — fit vs reference μ + blended forward ROI.

Reference profiles: SuperNova (cl.1), cluster 0, post-CD rise / neutral / decline.
"""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR, SIMULATION_CHARTS_SNAPSHOT_JSON

CURVE_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)

# Standard normalized ROI knots (% vs T−60) — pre-CD and post-CD
ROI_STANDARD_OFFSETS: tuple[int, ...] = (-10, -5, 4)

PROFILE_IDS = (
    "cluster1",
    "cluster0",
    "post_rialzo",
    "post_ribasso",
    "post_neutro",
)

# μ SuperNova cl.1 — aligned with desktop-ui/src/sheet/sdsHistoryCurve.ts
_CLUSTER1_MEAN: list[float] = [0.0, 38.99, 256.19, 318.23, 386.94, 377.94, 377.74, 390.5]

_REF_LABEL_TO_PROFILE: dict[str, str] = {
    "supernova (cl.1)": "cluster1",
    "μ supernova (cl.1)": "cluster1",
    "cluster 0": "cluster0",
    "μ cluster 0": "cluster0",
    "post-cd rialzo": "post_rialzo",
    "μ post-cd rialzo": "post_rialzo",
    "post-cd ribasso": "post_ribasso",
    "μ post-cd ribasso": "post_ribasso",
    "post-cd neutro": "post_neutro",
    "μ post-cd neutro": "post_neutro",
}


def _parse_num(v: Any) -> float | None:
    if v is None or v == "" or v == "—" or v == "-":
        return None
    if isinstance(v, (int, float)) and math.isfinite(float(v)):
        return float(v)
    s = str(v).strip().replace("%", "").replace(",", ".").replace("\u2212", "-")
    if not s or s.lower() in ("n/d", "nd", "nan"):
        return None
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def _parse_cd_days(cd_raw: Any) -> int | None:
    if cd_raw is None or cd_raw == "":
        return None
    s = str(cd_raw).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            cd = datetime.strptime(s, fmt).date()
            return (cd - date.today()).days
            break
        except ValueError:
            continue
    try:
        cd = datetime.fromisoformat(s).date()
        return (cd - date.today()).days
    except ValueError:
        return None


def _now_offset_from_cd(cd_raw: Any) -> int | None:
    days = _parse_cd_days(cd_raw)
    if days is None:
        return None
    return -days


def _offset_tail(off: int) -> str:
    return f"+{off}" if off > 0 else str(off)


def _find_pred_col(row: dict[str, Any], off: int) -> str | None:
    tail = _offset_tail(off)
    tail_u = f"+{off}" if off > 0 else f"\u2212{abs(off)}"
    for key in row:
        if "pred" not in key.lower() or "\u0394" not in key and "Δ" not in key:
            continue
        norm = key.replace("\n", " ").replace("\u2212", "-")
        if f"pred {tail}" in norm.lower() or f"pred {tail_u}" in key:
            return key
        if key.rstrip().endswith(tail) or key.rstrip().endswith(tail_u):
            return key
    canonical = f"\u0394% vs Pred\u221260\nPred\n{tail_u if off < 0 else tail}"
    if canonical in row:
        return canonical
    return None


def obs_curve_from_sim_row(row: dict[str, Any]) -> list[float | None]:
    """% vs T−60 at calendar knots from Simulation Δ% Pred columns."""
    out: list[float | None] = []
    for off in CURVE_OFFSETS:
        col = _find_pred_col(row, off)
        out.append(_parse_num(row.get(col)) if col else None)
    return out


def _interp_at_offset(values: list[float | None], target: int) -> float | None:
    pts = [(off, v) for off, v in zip(CURVE_OFFSETS, values) if v is not None]
    if not pts:
        return None
    pts.sort(key=lambda x: x[0])
    if target <= pts[0][0]:
        return pts[0][1]
    if target >= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        a_off, a_y = pts[i]
        b_off, b_y = pts[i + 1]
        if a_off <= target <= b_off:
            if b_off == a_off:
                return a_y
            t = (target - a_off) / (b_off - a_off)
            return a_y * (1.0 - t) + b_y * t
    return None


def rmse_pp_vs_ref(
    obs: list[float | None],
    ref: list[float | None] | None,
    *,
    min_pts: int = 3,
) -> tuple[float | None, int]:
    if not ref:
        return None, 0
    sq: list[float] = []
    for i, off in enumerate(CURVE_OFFSETS):
        ov = obs[i] if i < len(obs) else None
        rv = ref[i] if i < len(ref) else None
        if ov is None or rv is None:
            continue
        d = float(ov) - float(rv)
        sq.append(d * d)
    if len(sq) < min_pts:
        return None, len(sq)
    return round(math.sqrt(sum(sq) / len(sq)), 3), len(sq)


def fit_pct_from_rmse(rmse_pp: float | None) -> float | None:
    if rmse_pp is None:
        return None
    return round(max(0.0, min(100.0, 100.0 - float(rmse_pp))), 1)


def _normalize_ref_label(label: str) -> str:
    return re.sub(r"\s+", " ", label.strip().lower().replace("μ ", ""))


def _profile_from_series_label(label: str, sid: str) -> str | None:
    norm = _normalize_ref_label(label)
    sid_norm = _normalize_ref_label(sid.replace("ref:", ""))
    direct = _REF_LABEL_TO_PROFILE.get(norm) or _REF_LABEL_TO_PROFILE.get(sid_norm)
    if direct:
        return direct
    if "post-cd" in norm and "rialzo" in norm:
        return "post_rialzo"
    if "post-cd" in norm and "ribasso" in norm:
        return "post_ribasso"
    if "post-cd" in norm and "neutro" in norm:
        return "post_neutro"
    if "supernova" in norm or "cl.1" in norm or "cluster 1" in norm:
        return "cluster1"
    if "cluster 0" in norm or "cluster0" in norm:
        return "cluster0"
    return None


def _series_to_ref_values(points: list[dict[str, Any]]) -> list[float | None]:
    by_off: dict[int, float] = {}
    for pt in points or []:
        if not isinstance(pt, dict):
            continue
        off = pt.get("offset")
        if off is None:
            continue
        v = pt.get("pct_curva")
        if v is None:
            v = pt.get("pct_reale")
        if v is None:
            v = pt.get("pct_modello")
        n = _parse_num(v)
        if n is not None:
            by_off[int(off)] = n
    return [by_off.get(off) for off in CURVE_OFFSETS]


def load_reference_curves() -> dict[str, list[float | None]]:
    """Load μ reference curves from simulation_charts_snapshot.json."""
    refs: dict[str, list[float | None]] = {
        "cluster1": list(_CLUSTER1_MEAN),
    }
    path = Path(SIMULATION_CHARTS_SNAPSHOT_JSON)
    if not path.is_file():
        return refs
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return refs
    series = doc.get("series") if isinstance(doc, dict) else None
    if not isinstance(series, dict):
        return refs
    for sid, meta in series.items():
        if not isinstance(meta, dict) or meta.get("kind") != "control":
            continue
        label = str(meta.get("label") or sid.replace("ref:", ""))
        pid = _profile_from_series_label(label, str(sid))
        if not pid:
            continue
        vals = _series_to_ref_values(meta.get("points") or [])
        if sum(1 for v in vals if v is not None) >= 3:
            refs[pid] = vals
    if "cluster1" not in refs or sum(1 for v in refs["cluster1"] if v is not None) < 3:
        refs["cluster1"] = list(_CLUSTER1_MEAN)
    return refs


def _softmax_weights(scores: dict[str, float], tau: float = 12.0) -> dict[str, float]:
    if not scores:
        return {}
    mx = max(scores.values())
    exps = {k: math.exp((v - mx) / max(tau, 1e-6)) for k, v in scores.items()}
    s = sum(exps.values()) or 1.0
    return {k: round(v / s, 4) for k, v in exps.items()}


def scenario_weights(
    fit_pct: dict[str, float | None],
    *,
    sds: float | None = None,
    obs_n: int = 0,
    cluster_bonuses: dict[str, float] | None = None,
) -> dict[str, float]:
    scores: dict[str, float] = {}
    for pid in PROFILE_IDS:
        fp = fit_pct.get(pid)
        if fp is None:
            continue
        scores[pid] = float(fp)
    if sds is not None:
        if sds >= 75 and "cluster1" in scores:
            scores["cluster1"] += 12.0
        elif sds >= 55 and "cluster1" in scores:
            scores["cluster1"] += 5.0
        if sds < 55:
            for pid in ("post_neutro", "cluster0"):
                if pid in scores:
                    scores[pid] += 8.0
    for pid, bonus in (cluster_bonuses or {}).items():
        if pid in scores and bonus:
            scores[pid] += float(bonus)
    if not scores:
        return {}
    weights = _softmax_weights(scores)
    if obs_n >= 4:
        live_w = min(0.45, 0.08 * obs_n)
        scale = 1.0 - live_w
        weights = {k: round(v * scale, 4) for k, v in weights.items()}
        weights["_live"] = round(live_w, 4)
    return weights


def cluster_scenario_bonuses(sds_item: dict[str, Any]) -> dict[str, float]:
    """
    Map SDS clusters A–E to scenario-profile score bonuses (added before softmax).

    A → post-CD rise / SuperNova · B → squeeze vs bearish · C → price setup
    D → runway · E → timing window
    """
    if not sds_item:
        return {}

    bonuses: dict[str, float] = {}
    cs = sds_item.get("cluster_scores") if isinstance(sds_item.get("cluster_scores"), dict) else {}

    def bump(profile: str, amount: float) -> None:
        bonuses[profile] = bonuses.get(profile, 0.0) + amount

    # A · Catalyst quality
    ca = _parse_num(cs.get("catalyst_quality"))
    if ca is None and isinstance(sds_item.get("cluster_a"), dict):
        ca = _parse_num(sds_item["cluster_a"].get("total"))
    if ca is not None:
        if ca >= 24:
            bump("cluster1", 4.0)
            bump("post_rialzo", 8.0)
        elif ca >= 18:
            bump("post_rialzo", 5.0)
        elif ca < 10:
            bump("post_neutro", 4.0)

    # B · Institutional / short / analysts
    cb = sds_item.get("cluster_b") if isinstance(sds_item.get("cluster_b"), dict) else {}
    si = cb.get("short_interest") if isinstance(cb.get("short_interest"), dict) else {}
    if si.get("squeeze_setup"):
        bump("post_rialzo", 8.0)
        bump("cluster1", 5.0)
    if si.get("structural_bearish"):
        bump("post_ribasso", 10.0)
    au = cb.get("analyst_upgrades") if isinstance(cb.get("analyst_upgrades"), dict) else {}
    try:
        downgrades = int(au.get("downgrades_60d") or 0)
    except (TypeError, ValueError):
        downgrades = 0
    if downgrades >= 2:
        bump("post_ribasso", 6.0)
    if au.get("tier1_coverage"):
        bump("post_rialzo", 4.0)
    inst = cb.get("institutional_delta") if isinstance(cb.get("institutional_delta"), dict) else {}
    if inst.get("premium_fund_present"):
        bump("cluster1", 4.0)
        bump("post_rialzo", 3.0)
    b_score = _parse_num(cs.get("institutional_signal"))
    if b_score is not None and b_score >= 15:
        bump("post_rialzo", 3.0)
    elif b_score is not None and b_score < 8:
        bump("post_ribasso", 3.0)

    # C · Price structure
    cc = sds_item.get("cluster_c") if isinstance(sds_item.get("cluster_c"), dict) else {}
    bb = cc.get("bollinger_squeeze") if isinstance(cc.get("bollinger_squeeze"), dict) else {}
    bb_pct = _parse_num(bb.get("bb_percentile"))
    if bb_pct is not None and bb_pct <= 15:
        bump("cluster1", 6.0)
    obv = cc.get("obv_accumulation") if isinstance(cc.get("obv_accumulation"), dict) else {}
    pattern = str(obv.get("pattern") or "").lower()
    if "accumulation" in pattern:
        bump("cluster1", 4.0)
    if "distribution" in pattern or "bearish" in pattern:
        bump("post_ribasso", 5.0)
    c_score = _parse_num(cs.get("price_structure"))
    if c_score is not None and c_score >= 14:
        bump("cluster1", 3.0)

    # D · Fundamentals / runway
    cd = sds_item.get("cluster_d") if isinstance(sds_item.get("cluster_d"), dict) else {}
    runway = cd.get("cash_runway") if isinstance(cd.get("cash_runway"), dict) else {}
    months = _parse_num(runway.get("runway_months"))
    if months is None:
        months = _parse_num(runway.get("months"))
    if months is None:
        months = _parse_num(cd.get("runway_months"))
    if months is not None:
        if months >= 18:
            bump("cluster1", 2.0)
        elif months < 12:
            bump("post_neutro", 4.0)
            bump("post_ribasso", 3.0)

    # E · Timing
    days_raw = sds_item.get("days_to_cd")
    try:
        days = int(days_raw) if days_raw is not None else None
    except (TypeError, ValueError):
        days = None
    if days is not None:
        if 14 <= days <= 60:
            bump("cluster1", 5.0)
        elif days < 14:
            bump("post_neutro", 6.0)
        elif days > 60:
            bump("post_neutro", 4.0)
            bump("cluster0", 3.0)

    return {k: round(v, 2) for k, v in bonuses.items() if v > 0}


def _blend_curve_at_offset(
    offset: int,
    refs: dict[str, list[float | None]],
    weights: dict[str, float],
    obs: list[float | None],
) -> float | None:
    live_w = weights.get("_live", 0.0)
    prof_w = {k: v for k, v in weights.items() if not k.startswith("_")}
    total = live_w + sum(prof_w.values())
    if total <= 0:
        return _interp_at_offset(obs, offset)
    acc = 0.0
    w_sum = 0.0
    for pid, w in prof_w.items():
        ref = refs.get(pid)
        if not ref:
            continue
        v = _interp_at_offset(ref, offset)
        if v is None:
            continue
        acc += w * v
        w_sum += w
    if live_w > 0:
        lv = _interp_at_offset(obs, offset)
        if lv is not None:
            acc += live_w * lv
            w_sum += live_w
    if w_sum <= 0:
        return None
    return acc / w_sum


def horizon_roi_pp(
    obs: list[float | None],
    refs: dict[str, list[float | None]],
    weights: dict[str, float],
    now_offset: int,
    target_offset: int,
) -> float | None:
    y0 = _blend_curve_at_offset(now_offset, refs, weights, obs)
    y1 = _blend_curve_at_offset(target_offset, refs, weights, obs)
    if y0 is None or y1 is None:
        return None
    return round(y1 - y0, 2)


def normalized_roi_horizons(
    obs: list[float | None],
    refs: dict[str, list[float | None]],
    weights: dict[str, float],
    now_offset: int | None,
) -> dict[str, dict[str, float | None]]:
    """
    ROI normalizzato su T−10, T−5, T+4 (% vs T−60 sul profilo blended).
    Include ``delta_from_now`` quando ``now_offset`` è noto.
    """
    horizons: dict[str, dict[str, float | None]] = {}
    key_by_off = {-10: "pre_10", -5: "pre_5", 4: "post_4"}
    y_now = _blend_curve_at_offset(now_offset, refs, weights, obs) if now_offset is not None else None
    for off, key in key_by_off.items():
        level = _blend_curve_at_offset(off, refs, weights, obs)
        if level is None:
            continue
        entry: dict[str, float | None] = {"pct_vs_m60": round(level, 2)}
        if y_now is not None:
            entry["delta_from_now"] = round(level - y_now, 2)
        elif now_offset is not None and now_offset == off:
            entry["delta_from_now"] = 0.0
        horizons[key] = entry
    return horizons


def compute_curve_roi_blend(
    sim_row: dict[str, Any],
    *,
    sds: float | None = None,
    sds_item: dict[str, Any] | None = None,
    refs: dict[str, list[float | None]] | None = None,
) -> dict[str, Any] | None:
    obs = obs_curve_from_sim_row(sim_row)
    obs_n = sum(1 for v in obs if v is not None)
    if obs_n < 2:
        return None

    ref_map = refs if refs is not None else load_reference_curves()
    fit_pct: dict[str, float | None] = {}
    rmse_map: dict[str, float | None] = {}
    for pid in PROFILE_IDS:
        ref = ref_map.get(pid)
        rmse, _ = rmse_pp_vs_ref(obs, ref)
        rmse_map[pid] = rmse
        fit_pct[pid] = fit_pct_from_rmse(rmse)

    valid_fits = [(pid, fp) for pid, fp in fit_pct.items() if fp is not None]
    best_profile = None
    best_fit = None
    if valid_fits:
        best_profile, best_fit = max(valid_fits, key=lambda x: x[1])

    cluster_bonuses = cluster_scenario_bonuses(sds_item or {})
    weights = scenario_weights(
        fit_pct,
        sds=sds,
        obs_n=obs_n,
        cluster_bonuses=cluster_bonuses,
    )
    cd_raw = sim_row.get("Completion Date") or sim_row.get("CD")
    now_off = _now_offset_from_cd(cd_raw)
    if now_off is None:
        return {
            "fit_pct": fit_pct,
            "rmse_pp": rmse_map,
            "best_profile": best_profile,
            "best_fit_pct": best_fit,
            "weights": weights,
            "cluster_bonuses": cluster_bonuses,
            "horizons": {},
            "now_offset": None,
        }

    horizons = normalized_roi_horizons(obs, ref_map, weights, now_off)
    key_by_off = {-10: "pre_10", -5: "pre_5", 4: "post_4"}
    horizons_pred: dict[str, dict[str, float | None]] = {}
    for off, key in key_by_off.items():
        level = _interp_at_offset(obs, off)
        if level is not None:
            horizons_pred[key] = {"pct_vs_m60": round(level, 2)}

    calib_summary: dict[str, Any] | None = None
    try:
        from prediction.sds_roi_calibration import load_sds_roi_calibration

        calib_doc = load_sds_roi_calibration()
        profs = calib_doc.get("profiles") or {}
        calib_summary = {
            prof: {
                "n": (profs.get(prof) or {}).get("n"),
                "median_pct_vs_m60": (profs.get(prof) or {}).get("median_pct_vs_m60"),
            }
            for prof in PROFILE_IDS
        }
    except Exception:
        calib_summary = None

    return {
        "fit_pct": fit_pct,
        "rmse_pp": rmse_map,
        "best_profile": best_profile,
        "best_fit_pct": best_fit,
        "weights": weights,
        "cluster_bonuses": cluster_bonuses,
        "horizons": horizons,
        "horizons_pred": horizons_pred,
        "now_offset": now_off,
        "calibration_ref": calib_summary,
    }


def enrich_sds_row_with_curve_roi(
    item: dict[str, Any],
    sim_row: dict[str, Any],
    *,
    refs: dict[str, list[float | None]] | None = None,
) -> None:
    blend = compute_curve_roi_blend(sim_row, sds=item.get("sds"), sds_item=item, refs=refs)
    if blend:
        try:
            from prediction.sds_roi_correlation import estimate_roi_from_sds_correlation

            prof = blend.get("best_profile")
            sds_est = estimate_roi_from_sds_correlation(item.get("sds"), profile=prof)
            if sds_est and sds_est.get("horizons"):
                blend["sds_correlation_estimate"] = sds_est
                blend["horizons_curve"] = blend.get("horizons")
                blend["horizons"] = {
                    hk: {
                        "pct_vs_m60": hz.get("pct_vs_m60"),
                        "source": hz.get("source"),
                        "bin": hz.get("bin"),
                        "r": hz.get("r"),
                    }
                    for hk, hz in sds_est["horizons"].items()
                    if hz.get("pct_vs_m60") is not None
                }
        except Exception:
            pass
        item["curve_roi"] = blend
