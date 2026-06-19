"""
Learning Lab orchestration — cycle run, history, mock data, export, reset.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    CLUSTER_CAL_FACTORS_JSON,
    DATA_DIR,
    FEEDBACK_HISTORY_JSON,
    FEEDBACK_SUMMARY_JSON,
    LEARNING_HISTORY_JSON,
    LEARNING_LOG_JSON,
    REGIME_MULTIPLIERS_JSON,
    TICKER_PERFORMANCE_JSON,
)
from prediction.cluster_cal_factor import (
    collect_resolved_outcomes_from_sources,
    compute_cluster_cal_factors,
    get_global_cal_factor,
)
from prediction.regime_calibration import (
    compute_regime_multipliers,
    get_current_regime,
    get_regime_at_date,
    resolve_regime_outcomes_for_learning,
    sync_outcomes_from_signal_audit,
)

logger = logging.getLogger(__name__)

LEARNING_WEEK_MIN_N = 15
_OVERVIEW_CACHE: dict[str, Any] | None = None
_OVERVIEW_CACHE_MONO = 0.0
_OVERVIEW_CACHE_TTL_S = 90.0


def invalidate_overview_cache() -> None:
    """Drop in-process overview cache after apply/reset or manual refresh."""
    global _OVERVIEW_CACHE, _OVERVIEW_CACHE_MONO
    _OVERVIEW_CACHE = None
    _OVERVIEW_CACHE_MONO = 0.0


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


def append_learning_log(message: str, *, kind: str = "info", meta: dict | None = None) -> None:
    path = Path(LEARNING_LOG_JSON)
    doc = _load_json(path, {"schema_version": 1, "entries": []})
    entries = doc.get("entries") if isinstance(doc, dict) else []
    if not isinstance(entries, list):
        entries = []
    entries.append(
        {
            "ts": _now_iso(),
            "date": _today_iso(),
            "kind": kind,
            "message": message,
            "meta": meta or {},
        }
    )
    _save_json(path, {"schema_version": 1, "entries": entries[-500:]})


def _verdict(mae_delta: float | None, dir_delta: float | None, n: int, min_n: int) -> str:
    if n < min_n:
        return "collecting_data"
    if mae_delta is None:
        return "collecting_data"
    if mae_delta > 0:
        return "not_helping"
    if mae_delta <= -0.3 and (dir_delta or 0) >= 0.03:
        return "improving"
    if mae_delta <= -0.1 or (dir_delta or 0) >= 0.01:
        return "learning"
    return "neutral"


def _ticker_data_from_outcome(o: dict[str, Any]) -> dict[str, Any]:
    td = o.get("ticker_data")
    if isinstance(td, dict):
        return td
    return {"phase": o.get("phase", ""), "condition": o.get("condition", "")}


def _pair_metrics(pairs: list[tuple[float, float]]) -> tuple[float | None, float | None]:
    if not pairs:
        return None, None
    mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
    dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)
    return round(mae, 2), round(dir_acc, 3)


_REGIME_METRIC_KEYS = (
    "mae_before_regime",
    "mae_after_regime",
    "dir_before_regime",
    "dir_after_regime",
)


def _regime_tagged_outcomes(
    outcomes: list[dict[str, Any]],
    regime_outcomes: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Use dedicated regime store when large enough; else tag the main outcome pool."""
    if regime_outcomes is not None and len(regime_outcomes) >= LEARNING_WEEK_MIN_N:
        return regime_outcomes
    from prediction.regime_calibration import enrich_outcomes_with_regime

    return enrich_outcomes_with_regime(outcomes)


def _sanitize_week_metrics(week: dict[str, Any]) -> dict[str, Any]:
    """Drop regime-layer metrics when the regime sample is too small (misleading charts)."""
    row = dict(week)
    if int(row.get("n_regime_outcomes") or 0) < LEARNING_WEEK_MIN_N:
        for key in _REGIME_METRIC_KEYS:
            row[key] = None
    # Legacy snapshots may only store regime-layer direction; backfill sibling layers.
    if row.get("dir_after_cluster") is None and row.get("dir_before_regime") is not None:
        row["dir_after_cluster"] = row["dir_before_regime"]
    if row.get("dir_with_all") is None:
        row["dir_with_all"] = row.get("dir_after_regime") or row.get("dir_global_before")
    return row


def compute_counterfactual_layer_metrics(
    outcomes: list[dict[str, Any]],
    regime_outcomes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Real MAE / direction accuracy per learning layer (no synthetic multipliers)."""
    from prediction.cluster_cal_factor import build_cluster_blend_map, classify_ticker

    def collect(source: list[dict[str, Any]], transform) -> list[tuple[float, float]]:
        pairs: list[tuple[float, float]] = []
        for o in source:
            pred, actual = o.get("pred"), o.get("actual")
            if pred is None or actual is None:
                continue
            try:
                p, a = float(pred), float(actual)
            except (TypeError, ValueError):
                continue
            pairs.append((transform(p, o), a))
        return pairs

    ro = _regime_tagged_outcomes(outcomes, regime_outcomes)
    gcf = get_global_cal_factor()
    cluster_blend = build_cluster_blend_map(gcf)
    from prediction.regime_calibration import build_regime_multiplier_map

    regime_mult = build_regime_multiplier_map()

    def _scale_pred(p: float, factor: float) -> float:
        if abs(factor - 1.0) < 1e-6:
            return p
        return round(p * factor, 4)

    def after_cluster(p: float, o: dict[str, Any]) -> float:
        cluster = classify_ticker(_ticker_data_from_outcome(o))
        return _scale_pred(p, cluster_blend.get(cluster, 1.0))

    def after_cluster_regime(p: float, o: dict[str, Any]) -> float:
        x = after_cluster(p, o)
        reg = str(o.get("regime") or "NEUTRAL").upper()
        if reg == "CRISIS":
            reg = "RISK_OFF"
        return _scale_pred(x, regime_mult.get(reg, 1.0))

    def after_all(p: float, o: dict[str, Any]) -> float:
        return _scale_pred(after_cluster_regime(p, o), gcf)

    def baseline(p: float, _o: dict[str, Any]) -> float:
        return p

    baseline_pairs = collect(outcomes, baseline)
    cluster_pairs = collect(outcomes, after_cluster)
    all_pairs = collect(outcomes, after_all)
    regime_before_pairs = collect(ro, after_cluster)
    regime_after_pairs = collect(ro, after_cluster_regime)
    cluster_regime_pairs = collect(outcomes, after_cluster_regime)

    mae_baseline, dir_baseline = _pair_metrics(baseline_pairs)
    mae_after_cluster, dir_after_cluster = _pair_metrics(cluster_pairs)
    mae_with_all, dir_with_all = _pair_metrics(all_pairs)
    mae_before_regime, dir_before_regime = _pair_metrics(regime_before_pairs)
    mae_after_regime, dir_after_regime = _pair_metrics(regime_after_pairs)
    mae_global_before, dir_global_before = _pair_metrics(cluster_regime_pairs)

    metrics: dict[str, Any] = {
        "n_outcomes": len(baseline_pairs),
        "n_regime_outcomes": len(regime_before_pairs),
        "mae_baseline": mae_baseline,
        "mae_before_cluster": mae_baseline,
        "mae_after_cluster": mae_after_cluster,
        "dir_before_cluster": dir_baseline,
        "dir_after_cluster": dir_after_cluster,
        "mae_before_regime": mae_before_regime,
        "mae_after_regime": mae_after_regime,
        "dir_before_regime": dir_before_regime,
        "dir_after_regime": dir_after_regime,
        "mae_global_before": mae_global_before,
        "dir_global_before": dir_global_before,
        "mae_with_all": mae_with_all,
        "dir_with_all": dir_with_all,
    }
    if metrics["n_regime_outcomes"] < LEARNING_WEEK_MIN_N:
        for key in _REGIME_METRIC_KEYS:
            metrics[key] = None
    return metrics


def load_signal_calibration_snippet() -> dict[str, Any]:
    sig = _load_json(Path(DATA_DIR) / "signal_calibration.json", {})
    cohorts = sig.get("cohorts") if isinstance(sig.get("cohorts"), dict) else {}
    useful = cohorts.get("useful") if isinstance(cohorts.get("useful"), dict) else {}
    weekly = sig.get("weekly_actionable") if isinstance(sig.get("weekly_actionable"), list) else []
    return {
        "generated_at": sig.get("generated_at"),
        "log_rows": sig.get("log_rows"),
        "closed_rows": sig.get("closed_rows"),
        "pending_outcomes": sig.get("pending_outcomes"),
        "cohorts": cohorts,
        "useful_hit_pct": useful.get("hit_pct"),
        "useful_n": useful.get("n"),
        "weekly_actionable": weekly[-12:],
    }


def load_curve_impact_snippet() -> dict[str, Any]:
    doc = _load_json(Path(DATA_DIR) / "curve_impact_cumulative_state.json", {})
    return {
        "built_at": doc.get("built_at"),
        "n_events": doc.get("n_events"),
        "n_enriched": doc.get("n_enriched"),
        "summary": doc.get("last_summary") if isinstance(doc.get("last_summary"), dict) else {},
        "enrichment_summary": doc.get("last_enrichment_summary")
        if isinstance(doc.get("last_enrichment_summary"), dict)
        else {},
    }


def load_validation_feedback_snippet() -> dict[str, Any]:
    summary = _load_json(Path(FEEDBACK_SUMMARY_JSON), {})
    hist_doc = _load_json(Path(FEEDBACK_HISTORY_JSON), {"weeks": []})
    weeks = hist_doc.get("weeks") if isinstance(hist_doc, dict) else []
    if not isinstance(weeks, list):
        weeks = []
    return {
        "summary": summary if summary else None,
        "history": weeks[-12:],
    }


def _verdict_corr(delta_pp: float | None, n: int, min_n: int) -> str:
    """Verdict when the primary metric is correlation (higher = better)."""
    if n < min_n:
        return "collecting_data"
    if delta_pp is None:
        return "collecting_data"
    if delta_pp <= -3:
        return "not_helping"
    if delta_pp >= 3:
        return "improving"
    if delta_pp >= 1:
        return "learning"
    return "neutral"


def _reliable_learning_weeks(weeks: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Drop weekly snapshots with too few resolved outcomes (misleading MAE / dir charts)."""
    if not weeks:
        return []
    return [w for w in weeks if int(w.get("n_outcomes") or 0) >= LEARNING_WEEK_MIN_N]


def _looks_like_demo_history(weeks: list[dict[str, Any]]) -> bool:
    """Heuristic: seeded history shows n_outcomes stepping down by 2 with no live_snapshot rows."""
    if len(weeks) < 4:
        return False
    if any(w.get("live_snapshot") for w in weeks):
        return any(not w.get("live_snapshot") for w in weeks)
    ns = [int(w.get("n_outcomes") or 0) for w in weeks[:6]]
    if len(ns) < 4:
        return False
    steps = [ns[i] - ns[i + 1] for i in range(min(3, len(ns) - 1))]
    return all(s == 2 for s in steps)


def build_effectiveness_delta(
    *,
    live_metrics: dict[str, Any] | None = None,
    eis_overview: dict[str, Any] | None = None,
    polygon_doc: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    history = _load_json(Path(LEARNING_HISTORY_JSON), {"weeks": []})
    weeks = history.get("weeks") if isinstance(history, dict) else []
    reliable = _reliable_learning_weeks(weeks)
    hist_latest = reliable[-1] if reliable else {}
    hist_prev = reliable[-2] if len(reliable) >= 2 else {}

    if live_metrics is not None:
        live = live_metrics
    else:
        outcomes = collect_resolved_outcomes_from_sources()
        regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
        live = (
            compute_counterfactual_layer_metrics(outcomes, regime_outcomes)
            if len(outcomes) >= LEARNING_WEEK_MIN_N
            else {}
        )

    def live_or_hist(key: str, hist_key: str | None = None) -> Any:
        if live.get("n_outcomes", 0) >= LEARNING_WEEK_MIN_N and live.get(key) is not None:
            return live[key]
        return hist_latest.get(hist_key or key)

    n_out = (
        int(live["n_outcomes"])
        if live.get("n_outcomes", 0) >= LEARNING_WEEK_MIN_N
        else int(hist_latest.get("n_outcomes") or 0)
    )
    n_reg = (
        int(live["n_regime_outcomes"])
        if live.get("n_regime_outcomes", 0) >= LEARNING_WEEK_MIN_N
        else int(hist_latest.get("n_regime_outcomes") or 0)
    )

    rows = [
        {
            "mechanism": "global_cf",
            "label": "Global cal_factor",
            "mae_before": hist_prev.get("mae_global_before") or hist_prev.get("mae_baseline"),
            "mae_after": live_or_hist("mae_with_all"),
            "dir_before": hist_prev.get("dir_global_before") or hist_prev.get("dir_with_all"),
            "dir_after": live_or_hist("dir_with_all"),
            "n": n_out,
            "min_n": LEARNING_WEEK_MIN_N,
        },
        {
            "mechanism": "cluster_cf",
            "label": "Cluster cal_factor",
            "mae_before": hist_prev.get("mae_before_cluster") or live_or_hist("mae_baseline", "mae_baseline"),
            "mae_after": live_or_hist("mae_after_cluster"),
            "dir_before": hist_prev.get("dir_before_cluster") or live_or_hist("dir_before_cluster"),
            "dir_after": live_or_hist("dir_after_cluster"),
            "n": n_out,
            "min_n": LEARNING_WEEK_MIN_N,
        },
        {
            "mechanism": "regime_mult",
            "label": "Regime multiplier",
            "mae_before": hist_prev.get("mae_before_regime") or live_or_hist("mae_before_regime"),
            "mae_after": live_or_hist("mae_after_regime"),
            "dir_before": hist_prev.get("dir_before_regime") or live_or_hist("dir_before_regime"),
            "dir_after": live_or_hist("dir_after_regime"),
            "n": n_reg,
            "min_n": LEARNING_WEEK_MIN_N,
        },
    ]

    from prediction.cd_pattern_polygon_accuracy import load_cd_pattern_polygon_accuracy

    poly = polygon_doc if polygon_doc is not None else load_cd_pattern_polygon_accuracy()
    poly_hist = poly.get("learning_history") if isinstance(poly.get("learning_history"), list) else []
    poly_eff = poly.get("effectiveness") if isinstance(poly.get("effectiveness"), dict) else {}
    poly_latest = poly_hist[-1] if poly_hist else poly_eff
    poly_prev = poly_hist[-2] if len(poly_hist) >= 2 else {}
    poly_dir_before = poly_prev.get("mean_corr_match_stock") if isinstance(poly_prev, dict) else None
    poly_dir_after = (
        poly_latest.get("mean_corr_match_stock")
        if isinstance(poly_latest, dict)
        else poly_eff.get("mean_corr_match_stock")
    )
    rows.append(
        {
            "mechanism": "polygon_match",
            "label": "CD pattern polygon",
            "mae_before": None,
            "mae_after": None,
            "dir_before": poly_dir_before,
            "dir_after": poly_dir_after,
            "n": poly.get("n_samples") or 0,
            "min_n": 15,
        }
    )

    from prediction.eis_super_score_learning import build_eis_super_score_overview

    eis = eis_overview if eis_overview is not None else build_eis_super_score_overview()
    eis_hist = eis.get("learning_history") if isinstance(eis.get("learning_history"), list) else []
    eis_eff = eis.get("effectiveness") if isinstance(eis.get("effectiveness"), dict) else {}
    eis_prev = eis_hist[-2] if len(eis_hist) >= 2 else {}
    eis_latest = eis_hist[-1] if eis_hist else eis_eff
    eis_dir_before = eis_prev.get("mean_corr_super_7d") if isinstance(eis_prev, dict) else None
    eis_dir_after = (
        eis_latest.get("mean_corr_super_7d")
        if isinstance(eis_latest, dict)
        else eis_eff.get("mean_corr_super_7d")
    )
    rows.append(
        {
            "mechanism": "eis_super",
            "label": "EIS Super Score",
            "mae_before": None,
            "mae_after": None,
            "dir_before": eis_dir_before,
            "dir_after": eis_dir_after,
            "n": eis.get("n_events_scored") or 0,
            "min_n": 20,
        }
    )

    fb = load_validation_feedback_snippet()
    fb_hist = fb.get("history") if isinstance(fb.get("history"), list) else []
    fb_latest = (fb_hist[-1].get("summary") if fb_hist and isinstance(fb_hist[-1], dict) else None) or fb.get(
        "summary"
    )
    fb_prev = fb_hist[-2].get("summary") if len(fb_hist) >= 2 and isinstance(fb_hist[-2], dict) else {}
    if not isinstance(fb_prev, dict):
        fb_prev = {}
    if not isinstance(fb_latest, dict):
        fb_latest = {}
    rows.append(
        {
            "mechanism": "validation_feedback",
            "label": "Validation feedback loop",
            "mae_before": fb_prev.get("portfolio_avg_mae"),
            "mae_after": fb_latest.get("portfolio_avg_mae"),
            "dir_before": fb_prev.get("portfolio_direction_acc"),
            "dir_after": fb_latest.get("portfolio_direction_acc"),
            "n": fb_latest.get("n_tickers") or 0,
            "min_n": 5,
        }
    )

    sig = load_signal_calibration_snippet()
    weekly = sig.get("weekly_actionable") if isinstance(sig.get("weekly_actionable"), list) else []
    w_prev = weekly[-2] if len(weekly) >= 2 and isinstance(weekly[-2], dict) else {}
    w_latest = weekly[-1] if weekly and isinstance(weekly[-1], dict) else {}
    useful_hit = sig.get("useful_hit_pct")
    sig_dir_before = (float(w_prev["hit_pct"]) / 100.0) if w_prev.get("hit_pct") is not None else None
    sig_dir_after = (
        (float(w_latest["hit_pct"]) / 100.0)
        if w_latest.get("hit_pct") is not None
        else (float(useful_hit) / 100.0 if useful_hit is not None else None)
    )
    sig_n = w_latest.get("n") or sig.get("useful_n") or 0
    rows.append(
        {
            "mechanism": "signal_calibration",
            "label": "Pre-CD signal hit rate",
            "mae_before": None,
            "mae_after": None,
            "dir_before": sig_dir_before,
            "dir_after": sig_dir_after,
            "n": sig_n,
            "min_n": 10,
        }
    )

    curve = load_curve_impact_snippet()
    curve_sum = curve.get("summary") if isinstance(curve.get("summary"), dict) else {}
    rows.append(
        {
            "mechanism": "daily_recalib",
            "label": "Daily curve recalib",
            "mae_before": curve_sum.get("mae_base_pp"),
            "mae_after": curve_sum.get("mae_daily_pp"),
            "dir_before": (
                float(curve_sum["hit_base_pct"]) / 100.0 if curve_sum.get("hit_base_pct") is not None else None
            ),
            "dir_after": (
                float(curve_sum["hit_daily_pct"]) / 100.0 if curve_sum.get("hit_daily_pct") is not None else None
            ),
            "n": curve.get("n_events") or 0,
            "min_n": 15,
        }
    )

    for r in rows:
        mae_b, mae_a = r.get("mae_before"), r.get("mae_after")
        dir_b, dir_a = r.get("dir_before"), r.get("dir_after")
        r["mae_delta_pp"] = round(mae_a - mae_b, 2) if mae_a is not None and mae_b is not None else None
        r["dir_delta_pp"] = round((dir_a - dir_b) * 100, 1) if dir_a is not None and dir_b is not None else None
        if r.get("mechanism") in ("polygon_match", "eis_super", "signal_calibration"):
            r["verdict"] = _verdict_corr(r["dir_delta_pp"], r["n"], r["min_n"])
        else:
            r["verdict"] = _verdict(
                r["mae_delta_pp"],
                (r["dir_delta_pp"] or 0) / 100 if r["dir_delta_pp"] else None,
                r["n"],
                r["min_n"],
            )
    return rows


def snapshot_weekly_history(
    outcomes: list[dict[str, Any]],
    cluster_doc: dict[str, Any],
    regime_doc: dict[str, Any],
) -> None:
    regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
    metrics = compute_counterfactual_layer_metrics(outcomes, regime_outcomes)
    if not metrics.get("n_outcomes") or int(metrics["n_outcomes"]) < LEARNING_WEEK_MIN_N:
        logger.info(
            "Learning history snapshot skipped: n_outcomes=%s (min %s)",
            metrics.get("n_outcomes"),
            LEARNING_WEEK_MIN_N,
        )
        return

    path = Path(LEARNING_HISTORY_JSON)
    doc = _load_json(path, {"schema_version": 1, "weeks": []})
    weeks = doc.get("weeks") if isinstance(doc, dict) else []
    if not isinstance(weeks, list):
        weeks = []

    week_label = _today_iso()
    entry = {
        "week": week_label,
        **metrics,
        "global_cal_factor": get_global_cal_factor(),
        "active_clusters": sum(
            1
            for c in (cluster_doc.get("clusters") or {}).values()
            if isinstance(c, dict) and c.get("status") == "active"
        ),
        "cluster_cal_factors": {
            name: c.get("cal_factor")
            for name, c in (cluster_doc.get("clusters") or {}).items()
            if isinstance(c, dict) and c.get("cal_factor") is not None
        },
        "regime_multipliers": {
            name: (r.get("multiplier") if isinstance(r, dict) else None)
            for name, r in (regime_doc.get("regimes") or {}).items()
            if isinstance(r, dict) and r.get("multiplier") is not None
        },
    }
    weeks = [w for w in weeks if w.get("week") != week_label]
    weeks.append(entry)
    weeks = weeks[-52:]
    _save_json(path, {"schema_version": 1, "updated_at": _now_iso(), "weeks": weeks})


def run_learning_cycle(*, dry_run: bool = True) -> dict[str, Any]:
    sync_outcomes_from_signal_audit()
    outcomes = collect_resolved_outcomes_from_sources()
    from prediction.regime_calibration import resolve_regime_outcomes_for_learning

    regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)

    prev_cluster = _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {})
    prev_regime = _load_json(Path(REGIME_MULTIPLIERS_JSON), {})

    cluster_doc = compute_cluster_cal_factors(outcomes, dry_run=dry_run)
    regime_doc = compute_regime_multipliers(regime_outcomes, dry_run=dry_run)

    from prediction.eis_super_score_learning import run_eis_super_score_learning_cycle
    from prediction.cd_pattern_polygon_accuracy import (
        load_cd_pattern_polygon_accuracy,
        persist_cd_pattern_polygon_accuracy,
        polygon_mean_corr_changes,
    )

    prev_polygon = load_cd_pattern_polygon_accuracy()
    eis_diff = run_eis_super_score_learning_cycle(dry_run=dry_run)
    polygon_doc = persist_cd_pattern_polygon_accuracy(dry_run=dry_run)
    polygon_changes = polygon_mean_corr_changes(prev_polygon, polygon_doc)

    diff: dict[str, list] = {
        "cluster_changes": [],
        "regime_changes": [],
        "eis_super_changes": eis_diff.get("changes") or [],
        "polygon_changes": polygon_changes,
    }
    for name, new_entry in (cluster_doc.get("clusters") or {}).items():
        old = (prev_cluster.get("clusters") or {}).get(name) or {}
        old_cf = old.get("cal_factor")
        new_cf = new_entry.get("cal_factor") if isinstance(new_entry, dict) else None
        if old_cf != new_cf and new_cf is not None:
            diff["cluster_changes"].append(
                {
                    "cluster": name,
                    "from": old_cf,
                    "to": new_cf,
                    "bias_pp": new_entry.get("bias_pp"),
                    "n": new_entry.get("n_samples"),
                }
            )
    for name, new_entry in (regime_doc.get("regimes") or {}).items():
        old = (prev_regime.get("regimes") or {}).get(name) or {}
        old_m = old.get("multiplier")
        if isinstance(new_entry, dict) and old_m != new_entry.get("multiplier") and new_entry.get("status") == "active":
            diff["regime_changes"].append(
                {
                    "regime": name,
                    "from": old_m,
                    "to": new_entry.get("multiplier"),
                    "bias_pp": new_entry.get("bias_pp"),
                    "n": new_entry.get("n"),
                }
            )

    if not dry_run:
        for ch in diff["cluster_changes"]:
            append_learning_log(
                f"{ch['cluster']} cal_factor {ch['from']} → {ch['to']} (bias {ch['bias_pp']}pp, n={ch['n']})",
                kind="cluster_cf",
                meta=ch,
            )
        for ch in diff["regime_changes"]:
            append_learning_log(
                f"{ch['regime']} multiplier {ch['from']} → {ch['to']} (bias {ch['bias_pp']}pp, n={ch['n']})",
                kind="regime_mult",
                meta=ch,
            )
        for ch in eis_diff.get("changes") or []:
            append_learning_log(
                f"EIS super {ch['window']} cal {ch['from']} → {ch['to']} (n={ch['n']})",
                kind="eis_super",
                meta=ch,
            )
        for ch in polygon_changes:
            append_learning_log(
                f"Polygon ρ mean {ch['from']} → {ch['to']} (n={ch.get('n_samples')})",
                kind="polygon_match",
                meta=ch,
            )
        snapshot_weekly_history(outcomes, cluster_doc, regime_doc)
        invalidate_overview_cache()

    return {
        "ok": True,
        "dry_run": dry_run,
        "n_outcomes": len(outcomes),
        "n_regime_outcomes": len(regime_outcomes),
        "cluster_doc": cluster_doc,
        "regime_doc": regime_doc,
        "diff": diff,
        "eis_super_score": eis_diff,
        "cd_pattern_polygon": polygon_doc,
        "effectiveness": build_effectiveness_delta(),
    }


def reset_all_learning(*, dry_run: bool = True) -> dict[str, Any]:
    cluster_reset = {"schema_version": 1, "generated_at": _now_iso(), "clusters": {}, "reset": True}
    regime_reset = {
        "schema_version": 1,
        "generated_at": _now_iso(),
        "regimes": {r: {"multiplier": 1.0, "status": "insufficient_data", "n": 0} for r in ("RISK_ON", "NEUTRAL", "RISK_OFF")},
        "reset": True,
    }
    reset_targets: list[str] = ["cluster_cf", "regime_mult", "learning_history"]
    if not dry_run:
        _save_json(Path(CLUSTER_CAL_FACTORS_JSON), cluster_reset)
        _save_json(Path(REGIME_MULTIPLIERS_JSON), regime_reset)
        _save_json(Path(LEARNING_HISTORY_JSON), {"schema_version": 1, "updated_at": _now_iso(), "weeks": []})

        from prediction.eis_super_score_learning import default_learning_state

        _save_json(Path(DATA_DIR) / "eis_super_score_learning.json", default_learning_state())

        from prediction.cd_pattern_polygon_accuracy import (
            POLYGON_ACCURACY_JSON,
            build_cd_pattern_polygon_overview,
        )

        poly_doc = build_cd_pattern_polygon_overview()
        poly_doc["learning_history"] = []
        _save_json(Path(POLYGON_ACCURACY_JSON), poly_doc)

        _save_json(Path(FEEDBACK_SUMMARY_JSON), {"version": 1, "reset": True, "updated_at": _now_iso()})
        _save_json(Path(FEEDBACK_HISTORY_JSON), {"version": 1, "weeks": []})
        _save_json(Path(TICKER_PERFORMANCE_JSON), {"version": 1, "updated_at": _now_iso(), "tickers": {}})

        reset_targets.extend(["eis_super", "polygon_match", "validation_feedback"])
        append_learning_log(
            "Reset all learning — cluster/regime/EIS/polygon/feedback → neutral",
            kind="reset",
        )
        invalidate_overview_cache()
    return {"ok": True, "dry_run": dry_run, "reset": reset_targets}


def export_learning_report() -> dict[str, Any]:
    from prediction.market_context_gate import load_market_context

    return {
        "exported_at": _now_iso(),
        "global_cal_factor": get_global_cal_factor(),
        "current_regime": get_current_regime(),
        "market_context": load_market_context(),
        "cluster_cal_factors": _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {}),
        "regime_multipliers": _load_json(Path(REGIME_MULTIPLIERS_JSON), {}),
        "learning_history": _load_json(Path(LEARNING_HISTORY_JSON), {}),
        "learning_log": _load_json(Path(LEARNING_LOG_JSON), {}),
        "feedback_summary": _load_json(Path(FEEDBACK_SUMMARY_JSON), {}),
        "effectiveness": build_effectiveness_delta(),
    }


def _enrich_history_for_ui(
    history: dict[str, Any],
    cluster_doc: dict[str, Any],
    regime_doc: dict[str, Any],
) -> dict[str, Any]:
    """Fill missing per-week cluster/regime snapshots for charts (synthetic ramp 1.0 → current)."""
    weeks_in = history.get("weeks") if isinstance(history, dict) else []
    if not isinstance(weeks_in, list) or not weeks_in:
        return history if isinstance(history, dict) else {"weeks": []}

    weeks_in = _reliable_learning_weeks(weeks_in)
    if not weeks_in:
        out = dict(history) if isinstance(history, dict) else {"weeks": []}
        out["weeks"] = []
        out["low_sample_weeks_dropped"] = True
        return out

    clusters = cluster_doc.get("clusters") or {}
    current_cfs = {
        name: float(c["cal_factor"])
        for name, c in clusters.items()
        if isinstance(c, dict) and c.get("cal_factor") is not None
    }
    regimes = regime_doc.get("regimes") or {}
    current_regime = {
        name: float(r["multiplier"])
        for name, r in regimes.items()
        if isinstance(r, dict) and r.get("multiplier") is not None
    }

    enriched: list[dict[str, Any]] = []
    synthetic_cf = False
    synthetic_regime = False
    n = len(weeks_in)
    for i, w in enumerate(weeks_in):
        row = dict(w) if isinstance(w, dict) else {}
        t = i / max(1, n - 1)
        if not row.get("cluster_cal_factors") and current_cfs:
            row["cluster_cal_factors"] = {
                name: round(1.0 + (cf - 1.0) * t, 3) for name, cf in current_cfs.items()
            }
            synthetic_cf = True
        if not row.get("regime_multipliers") and current_regime:
            row["regime_multipliers"] = {
                name: round(1.0 + (mult - 1.0) * t, 3) for name, mult in current_regime.items()
            }
            synthetic_regime = True
        enriched.append(_sanitize_week_metrics(row))

    out = dict(history)
    out["weeks"] = enriched
    if synthetic_cf:
        out["cluster_cf_history_synthetic"] = True
    if synthetic_regime:
        out["regime_history_synthetic"] = True
    return out


def build_overview_payload(*, use_mock: bool = False, force_refresh: bool = False) -> dict[str, Any]:
    """Build Learning Lab overview. Never seeds fake data unless use_mock=True (dev only)."""
    global _OVERVIEW_CACHE, _OVERVIEW_CACHE_MONO
    if (
        not force_refresh
        and not use_mock
        and _OVERVIEW_CACHE is not None
        and (time.monotonic() - _OVERVIEW_CACHE_MONO) < _OVERVIEW_CACHE_TTL_S
    ):
        return _OVERVIEW_CACHE

    if use_mock:
        ensure_mock_data(force=True)
    elif not Path(CLUSTER_CAL_FACTORS_JSON).is_file():
        # Explicit unavailable — no silent demo numbers.
        pass

    cluster_doc = _load_json(Path(CLUSTER_CAL_FACTORS_JSON), {})
    regime_doc = _load_json(Path(REGIME_MULTIPLIERS_JSON), {})
    history = _load_json(Path(LEARNING_HISTORY_JSON), {"weeks": []})
    log_doc = _load_json(Path(LEARNING_LOG_JSON), {"entries": []})
    outcomes = collect_resolved_outcomes_from_sources()
    regime_outcomes = resolve_regime_outcomes_for_learning(outcomes)
    live_pool = (
        compute_counterfactual_layer_metrics(outcomes, regime_outcomes)
        if len(outcomes) >= LEARNING_WEEK_MIN_N
        else None
    )

    clusters = cluster_doc.get("clusters") or {}
    active_clusters = sum(1 for c in clusters.values() if isinstance(c, dict) and c.get("status") == "active")
    total_clusters = len(clusters) or 9

    regimes = regime_doc.get("regimes") or {}
    cur_regime = get_current_regime()
    cur_mult = (regimes.get(cur_regime) or {}).get("multiplier", 1.0)

    weeks = history.get("weeks") or []
    reliable = _reliable_learning_weeks(weeks)
    mae_trend = (
        round(reliable[-1].get("mae_with_all", 0) - reliable[-2].get("mae_with_all", 0), 2)
        if len(reliable) >= 2
        else None
    )

    last_outcome_date = max((str(o.get("date", ""))[:10] for o in outcomes), default="")
    days_stale = 999
    if last_outcome_date:
        try:
            days_stale = (date.today() - date.fromisoformat(last_outcome_date)).days
        except ValueError:
            pass

    if days_stale >= 14:
        health = "stalled"
    elif active_clusters < 3:
        health = "partial"
    else:
        health = "active"

    history = _enrich_history_for_ui(history, cluster_doc, regime_doc)

    reliable_weeks = _reliable_learning_weeks(history.get("weeks") or [])
    demo_history = _looks_like_demo_history(reliable_weeks)
    if demo_history:
        live_weeks = [w for w in history.get("weeks") or [] if w.get("live_snapshot")]
        if live_weeks:
            history = dict(history)
            history["weeks"] = live_weeks
            history["demo_weeks_suppressed"] = True

    from prediction.eis_super_score_learning import build_eis_super_score_overview
    from prediction.cd_pattern_polygon_accuracy import load_cd_pattern_polygon_accuracy

    eis_super = build_eis_super_score_overview()
    cd_pattern_polygon = load_cd_pattern_polygon_accuracy()
    validation_feedback = load_validation_feedback_snippet()
    signal_calibration = load_signal_calibration_snippet()
    curve_impact = load_curve_impact_snippet()

    fb_summary = validation_feedback.get("summary") if isinstance(validation_feedback.get("summary"), dict) else {}
    fb_updated = fb_summary.get("updated_at")

    payload = {
        "generated_at": _now_iso(),
        "use_mock": bool(cluster_doc.get("mock")),
        "data_available": bool(cluster_doc) and not cluster_doc.get("mock"),
        "cluster_data_missing": not bool(cluster_doc) or bool(cluster_doc.get("mock")),
        "regime_data_missing": not bool(regime_doc) or bool(regime_doc.get("mock")),
        "health": health,
        "global_cal_factor": get_global_cal_factor(),
        "active_clusters": active_clusters,
        "total_clusters": total_clusters,
        "current_regime": cur_regime,
        "current_regime_multiplier": cur_mult,
        "total_outcomes": len(outcomes),
        "mae_trend_pp_per_week": mae_trend,
        "live_pool": live_pool,
        "demo_history": demo_history,
        "learning_cycle": "weekly",
        "cluster_doc": cluster_doc,
        "regime_doc": regime_doc,
        "history": history,
        "learning_log": log_doc,
        "effectiveness": build_effectiveness_delta(
            live_metrics=live_pool or {},
            eis_overview=eis_super,
            polygon_doc=cd_pattern_polygon,
        ),
        "eis_super_score": eis_super,
        "cd_pattern_polygon": cd_pattern_polygon,
        "validation_feedback": validation_feedback,
        "signal_calibration": signal_calibration,
        "curve_impact": curve_impact,
        "pipeline": [
            {"id": "outcomes", "status": "active" if outcomes else "collecting", "last_updated": last_outcome_date or None},
            {"id": "kpi", "status": "active", "last_updated": _today_iso()},
            {"id": "cluster_cf", "status": "active" if active_clusters else "learning", "last_updated": cluster_doc.get("generated_at")},
            {"id": "regime_mult", "status": "active", "last_updated": regime_doc.get("generated_at")},
            {"id": "global_cf", "status": "active", "last_updated": _today_iso()},
            {"id": "eis_super", "status": "active" if eis_super.get("n_events_scored") else "collecting", "last_updated": eis_super.get("generated_at")},
            {
                "id": "polygon_match",
                "status": "active" if cd_pattern_polygon.get("n_events") else "collecting",
                "last_updated": cd_pattern_polygon.get("generated_at"),
            },
            {
                "id": "validation_feedback",
                "status": "active" if fb_summary.get("n_tickers") else "collecting",
                "last_updated": fb_updated,
            },
            {
                "id": "signal_calibration",
                "status": "active" if signal_calibration.get("useful_n") else "collecting",
                "last_updated": signal_calibration.get("generated_at"),
            },
            {
                "id": "daily_recalib",
                "status": "active" if curve_impact.get("n_events") else "collecting",
                "last_updated": curve_impact.get("built_at"),
            },
            {"id": "prediction", "status": "active", "last_updated": _today_iso()},
        ],
    }
    if not use_mock:
        _OVERVIEW_CACHE = payload
        _OVERVIEW_CACHE_MONO = time.monotonic()
    return payload


def ensure_mock_data(*, force: bool = False) -> None:
    """DEV ONLY — writes demo cluster/regime/history. Not called in production overview."""
    if not force:
        return
    if Path(CLUSTER_CAL_FACTORS_JSON).is_file() and not force:
        return

    today = _today_iso()
    mock_clusters: dict[str, Any] = {}
    for name, cf, n, bias, mae, direction in [
        ("phase2_oncology", 0.94, 12, 2.1, 2.8, "too_optimistic"),
        ("phase3_oncology", 0.97, 8, 1.2, 2.2, "too_optimistic"),
        ("phase2_rare", 1.05, 7, -0.8, 1.9, "too_pessimistic"),
        ("phase3_rare", 1.02, 6, -0.3, 1.7, "calibrated"),
        ("phase3_metabolic", 0.96, 9, 1.5, 2.4, "too_optimistic"),
        ("phase2_immuno", 1.0, 4, 0.2, 2.0, "calibrated"),
        ("phase3_immuno", 0.98, 5, 0.6, 2.1, "calibrated"),
        ("pdufa_regulatory", 0.92, 11, 2.4, 3.1, "too_optimistic"),
        ("phase1_2_early", 1.0, 3, 0.0, 2.5, "calibrated"),
        ("other", 1.0, 2, 0.1, 2.6, "calibrated"),
    ]:
        status = "active" if n >= 5 else "insufficient_data"
        mock_clusters[name] = {
            "cal_factor": cf if status == "active" else None,
            "bias_pp": bias,
            "mae": mae,
            "n_samples": n,
            "direction": direction,
            "status": status,
            "last_updated": today,
            "recent_outcomes": [],
        }

    _save_json(
        Path(CLUSTER_CAL_FACTORS_JSON),
        {"schema_version": 1, "generated_at": _now_iso(), "mock": True, "cluster_global_blend": 0.6, "clusters": mock_clusters},
    )
    _save_json(
        Path(REGIME_MULTIPLIERS_JSON),
        {
            "schema_version": 1,
            "generated_at": _now_iso(),
            "mock": True,
            "current_regime": "RISK_OFF",
            "regimes": {
                "RISK_ON": {"multiplier": 1.08, "bias_pp": -1.2, "mae": 2.1, "direction_acc": 0.64, "n": 34, "status": "active", "last_updated": today},
                "NEUTRAL": {"multiplier": 1.0, "bias_pp": 0.1, "mae": 2.4, "direction_acc": 0.55, "n": 22, "status": "active", "last_updated": today},
                "RISK_OFF": {"multiplier": 0.94, "bias_pp": 1.8, "mae": 2.6, "direction_acc": 0.51, "n": 41, "status": "active", "last_updated": today},
            },
        },
    )

    weeks = []
    base = date.today()
    cluster_names = list(mock_clusters.keys())
    cf_targets = {
        "phase2_oncology": 0.94,
        "phase3_oncology": 0.97,
        "phase2_rare": 1.05,
        "phase3_rare": 1.02,
        "phase3_metabolic": 0.96,
        "phase2_immuno": 1.0,
        "phase3_immuno": 0.98,
        "pdufa_regulatory": 0.92,
        "phase1_2_early": 1.0,
        "other": 1.0,
    }
    for i in range(12, 0, -1):
        wk = (base - timedelta(weeks=i)).isoformat()
        mae = round(3.2 - (12 - i) * 0.05, 2)
        t = (12 - i) / 12.0
        cluster_cfs = {
            name: round(1.0 + (cf_targets.get(name, 1.0) - 1.0) * t, 3) for name in cluster_names
        }
        weeks.append(
            {
                "week": wk,
                "n_outcomes": 120 + (12 - i) * 2,
                "mae_with_all": mae,
                "mae_baseline": round(mae + 0.4, 2),
                "dir_with_all": round(0.48 + (12 - i) * 0.004, 3),
                "mae_before_cluster": round(mae + 0.15, 2),
                "mae_after_cluster": round(mae + 0.05, 2),
                "mae_before_regime": round(mae + 0.08, 2),
                "mae_after_regime": mae,
                "dir_before_cluster": round(0.50 + (12 - i) * 0.003, 3),
                "dir_after_cluster": round(0.52 + (12 - i) * 0.004, 3),
                "dir_before_regime": round(0.51 + (12 - i) * 0.003, 3),
                "dir_after_regime": round(0.52 + (12 - i) * 0.004, 3),
                "n_regime_outcomes": 90,
                "global_cal_factor": round(1.06 - t * 0.03, 3),
                "active_clusters": min(6, 3 + (12 - i) // 2),
                "cluster_cal_factors": cluster_cfs,
                "regime_multipliers": {
                    "RISK_ON": round(1.0 + t * 0.08, 3),
                    "NEUTRAL": 1.0,
                    "RISK_OFF": round(1.0 - t * 0.06, 3),
                },
            }
        )
    _save_json(Path(LEARNING_HISTORY_JSON), {"schema_version": 1, "mock": True, "weeks": weeks})
    _save_json(
        Path(LEARNING_LOG_JSON),
        {
            "schema_version": 1,
            "mock": True,
            "entries": [
                {"ts": _now_iso(), "date": today, "kind": "cluster_cf", "message": f"{today}: phase2_oncology cal_factor 1.00 → 0.94 (bias +2.1pp, n=7)"},
                {"ts": _now_iso(), "date": today, "kind": "regime_mult", "message": f"{today}: RISK_OFF multiplier 1.00 → 0.96 (bias +1.8pp, n=12)"},
            ],
        },
    )
