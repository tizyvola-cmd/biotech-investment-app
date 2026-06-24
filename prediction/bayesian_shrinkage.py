"""
Bayesian win-rate shrinkage (Learning Lab Phase 5).

Computes per-cell shrunk win rates from closed simulation outcomes.
State: frozen weights / feature snapshots in calibration_state.py.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    INVESTMENT_SIM_OUTCOMES_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)
from prediction.calibration_buckets import (
    DIMENSIONS,
    bucket_clinical_phase,
    bucket_indication,
    bucket_pplan,
    bucket_sds,
    confidence_from_n,
    is_resolved,
    is_win,
)
from prediction.calibration_state import (
    append_shrinkage_history,
    load_feature_snapshots,
    save_feature_snapshots,
)
from prediction.investment_sim_outcomes import read_investment_sim_outcomes
from prediction.sds_data import load_sds_snapshot

DEFAULT_CONFIG = {
    "k": 8,
    "minNForSizing": 3,
    "minCellsForVariance": 2,
    "confidence": {"lowMax": 5, "mediumMax": 15},
}

LOSS_THRESHOLD_PCT = -2.0


def _col_match(row: dict[str, Any], pattern: str) -> str | None:
    rx = re.compile(pattern, re.I)
    for k in row:
        if rx.search(str(k).replace("\n", " ")):
            return k
    return None


def _clinical_phase_from_sim_row(row: dict[str, Any] | None) -> str:
    if not row:
        return ""
    col = _col_match(row, r"fase|phase")
    if not col:
        return ""
    v = str(row.get(col) or "").strip()
    return v if v and v != "—" else ""


def _clinical_indication_from_sim_row(row: dict[str, Any] | None, max_len: int = 200) -> str:
    if not row:
        return ""
    col = _col_match(row, r"indicaz|indication|terapeutic|conditions|condition")
    if not col:
        return ""
    v = str(row.get(col) or "").strip()
    if not v or v == "—":
        return ""
    return v if len(v) <= max_len else f"{v[: max_len - 1]}…"


def _load_sim_row_map() -> dict[str, dict[str, Any]]:
    path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return {}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = doc.get("rows") if isinstance(doc, dict) else []
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("Ticker") or row.get("ticker") or "").upper()
        cd = str(row.get("Completion date") or row.get("completion_date") or row.get("CD") or "")
        if not ticker:
            continue
        key = f"{ticker}|{cd[:10]}" if cd else ticker
        out[key] = row
        out[f"{ticker}|"] = row
    return out


def _load_sds_by_ticker() -> dict[str, float]:
    doc = load_sds_snapshot()
    out: dict[str, float] = {}
    for row in doc.get("rows") or []:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("ticker") or "").upper()
        sds = row.get("sds")
        if ticker and sds is not None:
            try:
                out[ticker] = float(sds)
            except (TypeError, ValueError):
                pass
    return out


def _row_key(row: dict[str, Any]) -> str:
    return str(row.get("row_key") or f"{row.get('ticker', '')}|{row.get('completion_date', '')}")


def _pplan_at_entry(row: dict[str, Any]) -> float | None:
    for k in ("entry_affidabilita_pct", "affidabilita_pct"):
        v = row.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _enrich_row(
    row: dict[str, Any],
    *,
    sim_rows: dict[str, dict[str, Any]],
    sds_by_ticker: dict[str, float],
    feature_snapshots: dict[str, Any],
) -> dict[str, str]:
    rk = _row_key(row)
    frozen = feature_snapshots.get(rk) if isinstance(feature_snapshots, dict) else None
    if isinstance(frozen, dict):
        return {
            "clinicalPhase": bucket_clinical_phase(str(frozen.get("clinicalPhase") or "")),
            "clinicalIndication": bucket_indication(str(frozen.get("clinicalIndication") or "")),
            "sdsBucket": bucket_sds(
                float(frozen["sds"]) if frozen.get("sds") is not None else None
            ),
            "pplanBucket": bucket_pplan(_pplan_at_entry(row)),
        }

    sim_row = sim_rows.get(rk) or sim_rows.get(f"{str(row.get('ticker', '')).upper()}|")
    ticker = str(row.get("ticker") or "").upper()
    sds = sds_by_ticker.get(ticker)
    phase_raw = _clinical_phase_from_sim_row(sim_row)
    ind_raw = _clinical_indication_from_sim_row(sim_row)
    pplan = _pplan_at_entry(row)

    cells = {
        "clinicalPhase": bucket_clinical_phase(phase_raw),
        "clinicalIndication": bucket_indication(ind_raw),
        "sdsBucket": bucket_sds(sds),
        "pplanBucket": bucket_pplan(pplan),
    }

    # Persist first-seen features server-side (mirrors frontend featureSnapshotStore).
    if rk and rk not in feature_snapshots:
        feature_snapshots[rk] = {
            "rowKey": rk,
            "frozenAt": None,
            "source": "backend",
            "sds": sds,
            "clinicalPhase": phase_raw or None,
            "clinicalIndication": ind_raw or None,
            "pplanPct": pplan,
        }

    return cells


def _build_cell_estimate(
    dimension: str,
    cell: str,
    rows: list[dict[str, Any]],
    prior: float,
    config: dict[str, Any],
) -> dict[str, Any]:
    if not rows:
        conf = config.get("confidence") or {}
        return {
            "dimension": dimension,
            "cell": cell,
            "n": 0,
            "wins": 0,
            "rawObserved": prior,
            "shrinkageApplied": prior,
            "prior": prior,
            "k": config["k"],
            "confidence": confidence_from_n(0, low_max=conf.get("lowMax", 5), medium_max=conf.get("mediumMax", 15)),
            "inactive": "no_data",
            "avgPnlPct": None,
            "capitalDeployedEur": 0,
        }

    wins = sum(1 for r in rows if is_win(r))
    n = len(rows)
    raw = wins / n
    k = float(config["k"])
    shrunk = (n * raw + k * prior) / (n + k)
    conf_thr = config.get("confidence") or {}
    conf = confidence_from_n(
        n,
        low_max=int(conf_thr.get("lowMax", 5)),
        medium_max=int(conf_thr.get("mediumMax", 15)),
    )
    min_n = int(config.get("minNForSizing", 3))
    inactive = None
    if n == 0:
        inactive = "no_data"
    elif n < min_n:
        inactive = "n_below_floor"
    sum_pnl = sum(float(r.get("pnl_pct") or 0) for r in rows)
    capital = sum(float(r.get("capital_eur") or 0) for r in rows)
    return {
        "dimension": dimension,
        "cell": cell,
        "n": n,
        "wins": wins,
        "rawObserved": round(raw, 4),
        "shrinkageApplied": round(shrunk, 4),
        "prior": round(prior, 4),
        "k": k,
        "confidence": conf,
        "inactive": inactive,
        "avgPnlPct": round(sum_pnl / n, 2) if n else None,
        "capitalDeployedEur": round(capital, 2),
    }


def _build_dimension_estimate(
    dimension: str,
    enriched: list[tuple[dict[str, Any], dict[str, str]]],
    global_prior: float,
    config: dict[str, Any],
) -> dict[str, Any]:
    by_cell: dict[str, list[dict[str, Any]]] = {}
    dim_wins = 0
    dim_total = 0
    for row, cells in enriched:
        cell = cells[dimension]
        by_cell.setdefault(cell, []).append(row)
        dim_total += 1
        if is_win(row):
            dim_wins += 1

    dimension_prior = dim_wins / dim_total if dim_total > 0 else global_prior
    prior = dimension_prior if dim_total >= int(config.get("minNForSizing", 3)) else global_prior

    cells = [_build_cell_estimate(dimension, cell, rows, prior, config) for cell, rows in by_cell.items()]
    cells.sort(key=lambda c: (-1 if c.get("inactive") is None else 1, -int(c.get("n") or 0)))
    cells_with_data = sum(1 for c in cells if int(c.get("n") or 0) > 0)
    has_variance = cells_with_data >= int(config.get("minCellsForVariance", 2))
    return {
        "dimension": dimension,
        "prior": round(prior, 4),
        "hasVariance": has_variance,
        "cells": cells,
        "totalN": dim_total,
    }


def _closed_outcomes() -> list[dict[str, Any]]:
    doc = read_investment_sim_outcomes(INVESTMENT_SIM_OUTCOMES_JSON)
    rows = doc.get("rows") if isinstance(doc, dict) else []
    if not isinstance(rows, list):
        return []
    out = []
    for r in rows:
        if not isinstance(r, dict) or not is_resolved(r):
            continue
        cap = r.get("capital_eur")
        try:
            if cap is not None and float(cap) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        out.append(r)
    return out


def compute_calibration_snapshot(
    outcomes: list[dict[str, Any]] | None = None,
    *,
    config: dict[str, Any] | None = None,
    persist_features: bool = False,
) -> dict[str, Any]:
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    resolved = outcomes if outcomes is not None else _closed_outcomes()
    sim_rows = _load_sim_row_map()
    sds_by_ticker = _load_sds_by_ticker()
    feature_snapshots = load_feature_snapshots()

    enriched: list[tuple[dict[str, Any], dict[str, str]]] = []
    global_wins = 0
    for row in resolved:
        cells = _enrich_row(row, sim_rows=sim_rows, sds_by_ticker=sds_by_ticker, feature_snapshots=feature_snapshots)
        enriched.append((row, cells))
        if is_win(row):
            global_wins += 1

    if persist_features:
        save_feature_snapshots(feature_snapshots)

    total = len(enriched)
    global_prior = global_wins / total if total > 0 else 0.5

    dimensions = {
        dim: _build_dimension_estimate(dim, enriched, global_prior, cfg) for dim in DIMENSIONS
    }

    from datetime import datetime, timezone

    return {
        "computedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "globalPrior": round(global_prior, 4),
        "totalTrades": total,
        "dimensions": dimensions,
    }


def preview_cycle() -> dict[str, Any]:
    snapshot = compute_calibration_snapshot(persist_features=False)
    active_cells = sum(
        1
        for dim in snapshot.get("dimensions", {}).values()
        for c in dim.get("cells") or []
        if c.get("inactive") is None and int(c.get("n") or 0) > 0
    )
    return {
        "ok": True,
        "dry_run": True,
        "snapshot": snapshot,
        "changes": [
            {
                "summary": "active_cells",
                "value": active_cells,
                "total_trades": snapshot.get("totalTrades"),
                "global_prior": snapshot.get("globalPrior"),
            }
        ],
    }


def apply_cycle(*, confirm: bool = True) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}
    snapshot = compute_calibration_snapshot(persist_features=True)
    entry = {
        "run_at": snapshot.get("computedAt"),
        "total_trades": snapshot.get("totalTrades"),
        "global_prior": snapshot.get("globalPrior"),
    }
    append_shrinkage_history(entry)
    return {
        "ok": True,
        "dry_run": False,
        "snapshot": snapshot,
        "changes": [entry],
    }


def reset_calibration(*, confirm: bool = True) -> dict[str, Any]:
    if not confirm:
        return {"ok": False, "error": "confirm_required"}
    from prediction.calibration_state import reset_feature_snapshots, reset_shrinkage_history

    reset_feature_snapshots()
    reset_shrinkage_history()
    return {"ok": True, "dry_run": False}


def build_status_excerpt() -> dict[str, Any]:
    hist = __import__("prediction.calibration_state", fromlist=["load_shrinkage_history"]).load_shrinkage_history()
    snapshot = compute_calibration_snapshot(persist_features=False)
    pending_cells = sum(
        1
        for dim in snapshot.get("dimensions", {}).values()
        for c in dim.get("cells") or []
        if int(c.get("n") or 0) > 0
    )
    last = hist[-1] if hist else None
    return {
        "total_trades": snapshot.get("totalTrades"),
        "global_prior": snapshot.get("globalPrior"),
        "cells_with_data": pending_cells,
        "last_run_at": last.get("run_at") if isinstance(last, dict) else snapshot.get("computedAt"),
        "history_len": len(hist),
    }
