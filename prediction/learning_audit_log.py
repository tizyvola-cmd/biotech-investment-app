"""
Cross-loop audit log + weekly metric time series for Learning Lab Phase 2.

Aggregates:
  * learning_log.json — human-readable cycle / apply events
  * learning_history.json — weekly MAE / direction snapshots
  * EIS super score history, polygon learning_history (when present)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import LEARNING_HISTORY_JSON, LEARNING_LOG_JSON

LEARNING_WEEK_MIN_N = 15


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _reliable_weeks(weeks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [w for w in weeks if int(w.get("n_outcomes") or 0) >= LEARNING_WEEK_MIN_N]


def _week_label(week: Any) -> str:
    s = str(week or "")
    return s[5:] if len(s) >= 7 else s


def build_learning_audit_log(*, limit: int = 200) -> dict[str, Any]:
    log_doc = _load_json(Path(LEARNING_LOG_JSON), {"entries": []})
    hist_doc = _load_json(Path(LEARNING_HISTORY_JSON), {"weeks": []})

    raw_entries = log_doc.get("entries") if isinstance(log_doc, dict) else []
    if not isinstance(raw_entries, list):
        raw_entries = []

    audit_entries: list[dict[str, Any]] = []
    for item in raw_entries:
        if not isinstance(item, dict):
            continue
        ts = item.get("ts") or item.get("date") or ""
        audit_entries.append(
            {
                "id": f"log-{ts}-{len(audit_entries)}",
                "source": "learning_log",
                "ts": ts,
                "kind": str(item.get("kind") or "info"),
                "message": str(item.get("message") or ""),
                "meta": item.get("meta") if isinstance(item.get("meta"), dict) else {},
            }
        )

    weeks_in = hist_doc.get("weeks") if isinstance(hist_doc, dict) else []
    if not isinstance(weeks_in, list):
        weeks_in = []
    reliable = _reliable_weeks([w for w in weeks_in if isinstance(w, dict)])

    weekly_metrics: list[dict[str, Any]] = []
    for w in reliable:
        weekly_metrics.append(
            {
                "week": w.get("week"),
                "week_label": _week_label(w.get("week")),
                "n_outcomes": int(w.get("n_outcomes") or 0),
                "mae_baseline": w.get("mae_baseline"),
                "mae_with_all": w.get("mae_with_all"),
                "mae_before_cluster": w.get("mae_before_cluster"),
                "mae_after_cluster": w.get("mae_after_cluster"),
                "mae_before_regime": w.get("mae_before_regime"),
                "mae_after_regime": w.get("mae_after_regime"),
                "dir_with_all": w.get("dir_with_all"),
                "dir_after_cluster": w.get("dir_after_cluster"),
                "dir_after_regime": w.get("dir_after_regime"),
                "global_cal_factor": w.get("global_cal_factor"),
                "live_snapshot": bool(w.get("live_snapshot")),
            }
        )
        ts = str(w.get("week") or "")
        if ts:
            mae = w.get("mae_with_all")
            audit_entries.append(
                {
                    "id": f"week-{ts}",
                    "source": "weekly_snapshot",
                    "ts": f"{ts}T12:00:00+00:00",
                    "kind": "snapshot",
                    "message": (
                        f"Weekly snapshot · MAE {mae:.2f}% · n={w.get('n_outcomes')}"
                        if mae is not None
                        else f"Weekly snapshot · n={w.get('n_outcomes')}"
                    ),
                    "meta": {
                        "mae_with_all": w.get("mae_with_all"),
                        "dir_with_all": w.get("dir_with_all"),
                        "n_outcomes": w.get("n_outcomes"),
                    },
                }
            )

    # EIS super score learning history
    try:
        from prediction.eis_super_score_learning import build_eis_super_score_overview

        eis = build_eis_super_score_overview()
        eis_hist = eis.get("learning_history") if isinstance(eis.get("learning_history"), list) else []
        for i, row in enumerate(eis_hist[-24:]):
            if not isinstance(row, dict):
                continue
            ts = str(row.get("run_at") or row.get("week") or "")
            audit_entries.append(
                {
                    "id": f"eis-{i}-{ts}",
                    "source": "eis_super_score",
                    "ts": ts,
                    "kind": "learning",
                    "message": (
                        f"EIS super score · ρ super 7d "
                        f"{row.get('mean_corr_super_7d', '—')}"
                    ),
                    "meta": row,
                }
            )
    except Exception:
        pass

    # Polygon learning history
    try:
        from prediction.cd_pattern_polygon_accuracy import load_cd_pattern_polygon_accuracy

        poly = load_cd_pattern_polygon_accuracy()
        poly_hist = poly.get("learning_history") if isinstance(poly.get("learning_history"), list) else []
        for i, row in enumerate(poly_hist[-24:]):
            if not isinstance(row, dict):
                continue
            ts = str(row.get("run_at") or row.get("week") or "")
            audit_entries.append(
                {
                    "id": f"poly-{i}-{ts}",
                    "source": "polygon_match",
                    "ts": ts,
                    "kind": "learning",
                    "message": (
                        f"Polygon match · ρ stock "
                        f"{row.get('mean_corr_match_stock', '—')}"
                    ),
                    "meta": row,
                }
            )
    except Exception:
        pass

    try:
        from prediction.portfolio_error_loop import load_calibration_doc

        pel = load_calibration_doc()
        pel_hist = pel.get("history") if isinstance(pel.get("history"), list) else []
        for i, row in enumerate(pel_hist[-24:]):
            if not isinstance(row, dict):
                continue
            ts = str(row.get("run_at") or "")
            delta = row.get("weighted_vs_equal_delta_eur")
            audit_entries.append(
                {
                    "id": f"pel-{i}-{ts}",
                    "source": "portfolio_error_loop",
                    "ts": ts,
                    "kind": "learning",
                    "message": (
                        f"Portfolio error loop · Δ weighted−equal {delta}€ · n={row.get('n_closed')}"
                    ),
                    "meta": row,
                }
            )
    except Exception:
        pass

    audit_entries.sort(key=lambda e: str(e.get("ts") or ""), reverse=True)
    audit_entries = audit_entries[: max(1, min(limit, 500))]

    return {
        "generated_at": _now_iso(),
        "schema_version": 1,
        "entries": audit_entries,
        "weekly_metrics": weekly_metrics,
        "counts": {
            "log_entries": len(raw_entries),
            "weekly_points": len(weekly_metrics),
            "audit_entries": len(audit_entries),
        },
    }
