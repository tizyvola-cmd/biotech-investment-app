"""
Validation feedback loop — per-ticker MAE / direction / bias → cal_factor adjustments.

``run_now(dry_run=True)`` returns proposed changes without writing.
``run_now(dry_run=False)`` applies after manual UI confirm.

Outputs:
  data/ticker_performance.json
  data/feedback_summary.json
  data/feedback_history.json  (last 12 weeks)
  updates cal_factor on pred_curve_seq_state events (per ticker)
"""
from __future__ import annotations

import json
import logging
import statistics
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import (
    FEEDBACK_HISTORY_JSON,
    FEEDBACK_SUMMARY_JSON,
    PAST_CATALYST_PREDICTIONS_JSON,
    TICKER_PERFORMANCE_JSON,
)
from past_pred_io import load_past_pred_map
from prediction.evaluationFramework import (
    NODE_CHECKPOINTS,
    actual_pct_at_node,
    pred_base_at_node,
)
from prediction.seq_calib import pred_curve_seq_load, pred_curve_seq_save

logger = logging.getLogger(__name__)

TickerFlag = Literal[
    "ok",
    "insufficient_data",
    "underperformer",
    "strong_performer",
    "systematic_optimism_bias",
    "systematic_pessimism_bias",
    "direction_unreliable",
]

THRESHOLDS: dict[str, float] = {
    "min_resolved_nodes": 3,
    "underperformer_mae_mult": 2.0,
    "strong_mae_mult": 0.5,
    "strong_dir_acc_min": 0.6,
    "cal_factor_floor": 0.7,
    "cal_factor_ceiling": 1.3,
    "cal_reduce_step": 0.05,
    "cal_increase_step": 0.03,
    "bias_flag_pp": 2.5,
    "bias_consecutive_nodes": 3,
    "direction_suspend_acc": 0.35,
    "direction_suspend_min_nodes": 5,
    # Above this absolute MAE (pp) a ticker is treated as corrupt/outlier data:
    # excluded from the portfolio average and never used to drive a cal_factor
    # change (one freak penny-stock move once inflated the avg to ~1668%).
    "mae_outlier_cap_pp": 300.0,
}


def _portfolio_center_mae(perf: dict[str, dict[str, Any]]) -> float | None:
    """Mean per-ticker MAE with corrupt/outlier tickers excluded.

    A single absurd value (e.g. MAE 1668%) otherwise dominates the average and
    distorts every relative threshold (under/over-performer bars).
    """
    cap = THRESHOLDS["mae_outlier_cap_pp"]
    maes = [
        p["persistent_mae"]
        for p in perf.values()
        if p.get("persistent_mae") is not None
        and p.get("flag") not in ("insufficient_data",)
        and p["persistent_mae"] <= cap
    ]
    return round(statistics.mean(maes), 3) if maes else None


FEEDBACK_NODES = ("T-10", "T-5", "T-3")


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


def _parse_cd(rec: dict) -> date | None:
    cd = rec.get("completion_date")
    if isinstance(cd, date):
        return cd
    if isinstance(cd, str) and cd.strip():
        for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(cd.strip()[:10], fmt).date()
            except ValueError:
                continue
        try:
            return date.fromisoformat(cd.strip()[:10])
        except ValueError:
            return None
    return None


def _is_resolved(rec: dict, *, today: date | None = None) -> bool:
    cd = _parse_cd(rec)
    if cd is None:
        return False
    ref = today or date.today()
    return cd < ref


def _node_map() -> dict[str, tuple[str, str]]:
    return {name: (pred_k, close_k) for name, _off, pred_k, close_k in NODE_CHECKPOINTS}


def _ticker_node_errors(rec: dict) -> list[dict[str, Any]]:
    """Per-node pred vs actual for T-10, T-5, T-3."""
    nm = _node_map()
    out: list[dict[str, Any]] = []
    for node in FEEDBACK_NODES:
        pred_k, close_k = nm[node]
        pred = pred_base_at_node(rec, pred_k)
        act = actual_pct_at_node(rec, close_k)
        if pred is None or act is None:
            continue
        err = round(pred - act, 4)
        out.append(
            {
                "node": node,
                "pred": pred,
                "actual": act,
                "abs_err": abs(err),
                "err": err,
                "dir_hit": (pred >= 0) == (act >= 0),
            }
        )
    return out


def compute_ticker_performance(
    past_rows: list[dict] | None = None,
    *,
    today: date | None = None,
) -> dict[str, dict[str, Any]]:
    """Aggregate per-ticker metrics from resolved past catalyst rows."""
    if past_rows is None:
        past_map = load_past_pred_map(PAST_CATALYST_PREDICTIONS_JSON)
        past_rows = list(past_map.values()) if isinstance(past_map, dict) else []

    by_ticker: dict[str, list[dict]] = {}
    for rec in past_rows:
        if not isinstance(rec, dict):
            continue
        if not _is_resolved(rec, today=today):
            continue
        tk = str(rec.get("ticker") or "").strip().upper()
        if not tk:
            continue
        nodes = _ticker_node_errors(rec)
        if not nodes:
            continue
        by_ticker.setdefault(tk, []).extend(nodes)

    perf: dict[str, dict[str, Any]] = {}
    for tk, nodes in by_ticker.items():
        if len(nodes) < THRESHOLDS["min_resolved_nodes"]:
            perf[tk] = {
                "persistent_mae": None,
                "direction_acc": None,
                "bias": None,
                "n_nodes": len(nodes),
                "last_updated": _today_iso(),
                "flag": "insufficient_data",
            }
            continue

        abs_errs = [n["abs_err"] for n in nodes]
        errs = [n["err"] for n in nodes]
        dir_hits = [n["dir_hit"] for n in nodes]
        t5_nodes = [n for n in nodes if n["node"] == "T-5"]
        dir_acc = (
            sum(1 for n in t5_nodes if n["dir_hit"]) / len(t5_nodes) if t5_nodes else None
        )
        if dir_acc is None:
            dir_acc = sum(dir_hits) / len(dir_hits) if dir_hits else None

        perf[tk] = {
            "persistent_mae": round(statistics.mean(abs_errs), 3),
            "direction_acc": round(dir_acc, 3) if dir_acc is not None else None,
            "bias": round(statistics.mean(errs), 3),
            "n_nodes": len(nodes),
            "last_updated": _today_iso(),
            "flag": "ok",
        }

        # Consecutive bias on last N nodes (sorted by node order T-10,T-5,T-3 per record — pooled)
        recent = errs[-int(THRESHOLDS["bias_consecutive_nodes"]) :]
        if len(recent) >= THRESHOLDS["bias_consecutive_nodes"]:
            if all(e > THRESHOLDS["bias_flag_pp"] for e in recent):
                perf[tk]["flag"] = "systematic_optimism_bias"
            elif all(e < -THRESHOLDS["bias_flag_pp"] for e in recent):
                perf[tk]["flag"] = "systematic_pessimism_bias"

    return perf


def _read_ticker_cal_factor(tk: str, seq_doc: dict) -> float:
    events = seq_doc.get("events") or {}
    for ev in events.values():
        if not isinstance(ev, dict):
            continue
        if str(ev.get("ticker") or "").upper() == tk:
            cf = ev.get("cal_factor")
            if cf is not None:
                try:
                    return float(cf)
                except (TypeError, ValueError):
                    pass
    return 1.0


def _propose_cal_changes(
    perf: dict[str, dict[str, Any]],
    seq_doc: dict,
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """Return cal_factor change proposals + flag lists."""
    portfolio_avg_mae = _portfolio_center_mae(perf)

    underperformers: list[str] = []
    strong: list[str] = []
    bias_flags: list[str] = []
    direction_suspended: list[str] = []
    data_outliers: list[str] = []
    changes: list[dict[str, Any]] = []

    for tk, p in sorted(perf.items()):
        flag = p.get("flag") or "ok"
        mae = p.get("persistent_mae")
        dir_acc = p.get("direction_acc")
        bias = p.get("bias")
        old_cal = _read_ticker_cal_factor(tk, seq_doc)
        new_cal = old_cal
        reason: str | None = None

        if flag == "insufficient_data":
            continue

        if mae is not None and mae > THRESHOLDS["mae_outlier_cap_pp"]:
            p["flag"] = "data_outlier"
            p["cal_factor"] = round(old_cal, 4)
            data_outliers.append(tk)
            continue

        if (
            portfolio_avg_mae is not None
            and mae is not None
            and mae > portfolio_avg_mae * THRESHOLDS["underperformer_mae_mult"]
        ):
            flag = "underperformer"
            new_cal = max(THRESHOLDS["cal_factor_floor"], old_cal - THRESHOLDS["cal_reduce_step"])
            reason = f"persistent MAE {mae:.1f}% > 2× portfolio avg"
            underperformers.append(tk)
        elif (
            portfolio_avg_mae is not None
            and mae is not None
            and mae < portfolio_avg_mae * THRESHOLDS["strong_mae_mult"]
            and dir_acc is not None
            and dir_acc > THRESHOLDS["strong_dir_acc_min"]
        ):
            flag = "strong_performer"
            new_cal = min(THRESHOLDS["cal_factor_ceiling"], old_cal + THRESHOLDS["cal_increase_step"])
            reason = f"strong accuracy MAE {mae:.1f}% dir {dir_acc:.0%}"
            strong.append(tk)

        if flag in ("systematic_optimism_bias", "systematic_pessimism_bias"):
            bias_flags.append(tk)
            p["bias_correction_pp"] = round(-float(bias or 0) / 2.0, 3)

        if (
            dir_acc is not None
            and p.get("n_nodes", 0) >= THRESHOLDS["direction_suspend_min_nodes"]
            and dir_acc < THRESHOLDS["direction_suspend_acc"]
        ):
            flag = "direction_unreliable"
            direction_suspended.append(tk)
            p["direction_live_suppressed"] = True

        p["flag"] = flag
        p["cal_factor"] = round(new_cal, 4)

        if new_cal != old_cal and reason:
            changes.append(
                {
                    "ticker": tk,
                    "old_cal": round(old_cal, 4),
                    "new_cal": round(new_cal, 4),
                    "reason": reason,
                }
            )
            logger.info(
                "[FeedbackLoop] cal_factor %s: %.3f → %.3f (%s)",
                tk,
                old_cal,
                new_cal,
                reason,
            )

    summary_flags = {
        "underperformers": underperformers,
        "strong_performers": strong,
        "bias_flags": bias_flags,
        "direction_suspended": direction_suspended,
        "data_outliers": data_outliers,
    }
    return changes, summary_flags


def _apply_cal_to_seq(seq_doc: dict, perf: dict[str, dict[str, Any]]) -> dict:
    events = seq_doc.get("events") or {}
    for key, ev in events.items():
        if not isinstance(ev, dict):
            continue
        tk = str(ev.get("ticker") or "").upper()
        if tk in perf and perf[tk].get("cal_factor") is not None:
            ev["cal_factor"] = perf[tk]["cal_factor"]
            if perf[tk].get("bias_correction_pp") is not None:
                ev["bias_correction_pp"] = perf[tk]["bias_correction_pp"]
            if perf[tk].get("direction_live_suppressed"):
                ev["direction_live_suppressed"] = True
        events[key] = ev
    seq_doc["events"] = events
    return seq_doc


def build_portfolio_summary(
    perf: dict[str, dict[str, Any]],
    changes: list[dict[str, Any]],
    summary_flags: dict[str, list[str]],
) -> dict[str, Any]:
    dirs = [p["direction_acc"] for p in perf.values() if p.get("direction_acc") is not None]
    return {
        "version": 1,
        "updated_at": _now_iso(),
        "portfolio_avg_mae": _portfolio_center_mae(perf),
        "portfolio_direction_acc": round(statistics.mean(dirs), 3) if dirs else None,
        "underperformers": summary_flags.get("underperformers") or [],
        "strong_performers": summary_flags.get("strong_performers") or [],
        "bias_flags": summary_flags.get("bias_flags") or [],
        "direction_suspended": summary_flags.get("direction_suspended") or [],
        "data_outliers": summary_flags.get("data_outliers") or [],
        "cal_factor_changes": changes,
        "n_tickers": len(perf),
    }


def run_now(*, dry_run: bool = True) -> dict[str, Any]:
    """
    Compute ticker performance and optional cal_factor updates.

    ``dry_run=True`` (default): preview only — nothing written except logs.
    """
    perf = compute_ticker_performance()
    seq_doc = pred_curve_seq_load()
    changes, summary_flags = _propose_cal_changes(perf, seq_doc)
    summary = build_portfolio_summary(perf, changes, summary_flags)

    result: dict[str, Any] = {
        "ok": True,
        "dry_run": dry_run,
        "run_at": _now_iso(),
        "ticker_performance": perf,
        "summary": summary,
        "cal_factor_changes": changes,
    }

    if dry_run:
        logger.info(
            "[FeedbackLoop] dry-run: %d ticker(s), %d cal change(s) proposed",
            len(perf),
            len(changes),
        )
        return result

    _save_json(Path(TICKER_PERFORMANCE_JSON), {"version": 1, "updated_at": _now_iso(), "tickers": perf})
    _save_json(Path(FEEDBACK_SUMMARY_JSON), summary)

    hist = _load_json(Path(FEEDBACK_HISTORY_JSON), {"weeks": []})
    weeks = list(hist.get("weeks") or [])
    weeks.append({"run_at": _now_iso(), "summary": summary})
    weeks = weeks[-12:]
    _save_json(Path(FEEDBACK_HISTORY_JSON), {"version": 1, "weeks": weeks})

    if changes:
        seq_doc = _apply_cal_to_seq(seq_doc, perf)
        pred_curve_seq_save(seq_doc)

    logger.info("[FeedbackLoop] applied %d cal_factor change(s)", len(changes))
    return result


def run_weekly(*, dry_run: bool = False) -> dict[str, Any]:
    """Scheduled entry (Sundays) — same as run_now with dry_run configurable."""
    return run_now(dry_run=dry_run)


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write changes (default: dry-run)")
    args = ap.parse_args()
    out = run_now(dry_run=not args.apply)
    print(json.dumps(out["summary"], indent=2, ensure_ascii=False))
