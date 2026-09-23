"""
Load SuperNova historical catalyst events into a unified event-level panel.

Sources:
  - past_catalyst_predictions.json  (archived + completed catalysts, ~12k events)
  - simulation_sheet_snapshot.json  (active pipeline tickers)
  - clinical_pre_cd_enrichment_snapshot.json  (EIS / clinical context, optional)
"""
from __future__ import annotations

import json
import logging
import math
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from orchestrator_io_paths import DATA_DIR, PAST_CATALYST_PREDICTIONS_JSON, SIMULATION_SHEET_SNAPSHOT_JSON

CLINICAL_PRE_CD_SNAPSHOT = Path(DATA_DIR) / "clinical_pre_cd_enrichment_snapshot.json"


def _float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _parse_cd(v: Any) -> date | None:
    if isinstance(v, date):
        return v
    s = str(v or "").strip()[:10]
    if len(s) < 10:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def event_key(ticker: str, cd: date | str | None) -> str:
    tk = str(ticker).strip().upper()
    d = _parse_cd(cd)
    return f"{tk}|{d.isoformat()}" if d else tk


def _row_from_past_record(key: str, rec: dict[str, Any]) -> dict[str, Any] | None:
    ticker = str(rec.get("ticker") or key.split("|")[0]).strip().upper()
    cd = _parse_cd(rec.get("completion_date") or (key.split("|")[1] if "|" in key else None))
    if not ticker or not cd:
        return None

    cm60 = _float(rec.get("close_m60"))
    cm30 = _float(rec.get("close_m30"))
    cm10 = _float(rec.get("close_m10"))
    cm7 = _float(rec.get("close_m7"))
    cm5 = _float(rec.get("close_m5"))
    cm3 = _float(rec.get("close_m3"))

    lows = [x for x in (cm10, cm30, cm60) if x is not None and x > 0]
    dump_proxy = None
    if cm60 and cm60 > 0 and cm30:
        dump_proxy = (min(lows) / cm60 - 1.0) * 100.0 if lows else None

    pre_run = (cm30 / cm60 - 1.0) * 100.0 if cm60 and cm30 and cm60 > 0 else None
    run_m30_m3 = (cm3 / cm30 - 1.0) * 100.0 if cm30 and cm3 and cm30 > 0 else None
    run_m10_m3 = (cm3 / cm10 - 1.0) * 100.0 if cm10 and cm3 and cm10 > 0 else None

    return {
        "event_key": event_key(ticker, cd),
        "ticker": ticker,
        "completion_date": cd.isoformat(),
        "pipeline_state": "archived",
        "affidabilita": str(rec.get("affidabilita") or "").strip(),
        "phase": str(rec.get("phase") or rec.get("clinical_phase") or "").strip(),
        "close_m60": cm60,
        "close_m30": cm30,
        "close_m10": cm10,
        "close_m7": cm7,
        "close_m5": cm5,
        "close_m3": cm3,
        "d5_pct": _float(rec.get("d5_pct")),
        "d10_pct": _float(rec.get("d10_pct")),
        "vol_ratio": _float(rec.get("vol_ratio")),
        "vol_accel": _float(rec.get("vol_accel")),
        "vol_price_div": _float(rec.get("vol_price_div")),
        "slope_5d": _float(rec.get("slope_5d")),
        "slope_20d": _float(rec.get("slope_20d")),
        "slope_45d": _float(rec.get("slope_45d")),
        "run_up_7d": _float(rec.get("run_up_7d")),
        "run_up_30d": _float(rec.get("run_up_30d")),
        "rsi_14": _float(rec.get("rsi_14")),
        "exc_slope_vs_XBI": _float(rec.get("exc_slope_vs_XBI")),
        "pcr_options": _float(rec.get("pcr_options")),
        "dump_proxy_pct": dump_proxy,
        "pre_run_m60_m30_pct": pre_run,
        "run_m30_m3_pct": run_m30_m3,
        "run_m10_m3_pct": run_m10_m3,
        "outcome_success_5pct": run_m30_m3 is not None and run_m30_m3 >= 5.0,
        "outcome_success_10pct": run_m30_m3 is not None and run_m30_m3 >= 10.0,
    }


def load_past_catalyst_events(
    json_path: str | Path | None = None,
) -> pd.DataFrame:
    from past_pred_io import default_past_pred_json, load_past_pred_map

    path = str(json_path or default_past_pred_json(str(ROOT)))
    raw = load_past_pred_map(path)
    rows: list[dict[str, Any]] = []
    for key, rec in raw.items():
        row = _row_from_past_record(key, rec)
        if row and row.get("close_m30") and row.get("close_m3"):
            rows.append(row)
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    return df.drop_duplicates(subset=["event_key"], keep="last").reset_index(drop=True)


def load_active_sim_events() -> pd.DataFrame:
    path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return pd.DataFrame()
    doc = json.loads(path.read_text(encoding="utf-8"))
    sim_rows = doc.get("rows") or doc.get("data") or []
    rows: list[dict[str, Any]] = []
    for rec in sim_rows:
        ticker = str(rec.get("Ticker") or rec.get("ticker") or "").strip().upper()
        cd = _parse_cd(rec.get("Completion Date") or rec.get("completion_date"))
        if not ticker or not cd:
            continue
        rows.append(
            {
                "event_key": event_key(ticker, cd),
                "ticker": ticker,
                "completion_date": cd.isoformat(),
                "pipeline_state": "active",
                "affidabilita": str(rec.get("Affidabilità") or rec.get("affidabilita") or "").strip(),
                "phase": str(rec.get("Phase") or rec.get("phase") or "").strip(),
                "vol_ratio": _float(rec.get("vol_ratio")),
                "slope_20d": _float(rec.get("slope_20d")),
                "run_up_30d": _float(rec.get("run_up_30d")),
                "rsi_14": _float(rec.get("rsi_14")),
            }
        )
    return pd.DataFrame(rows).drop_duplicates(subset=["event_key"], keep="last")


def attach_clinical_eis(df: pd.DataFrame) -> pd.DataFrame:
    path = CLINICAL_PRE_CD_SNAPSHOT
    if not path.is_file() or df.empty:
        df = df.copy()
        df["clinical_event_count"] = np.nan
        df["eis_score_max"] = np.nan
        return df

    doc = json.loads(path.read_text(encoding="utf-8"))
    records = doc.get("records") or doc.get("data") or []
    by_key: dict[str, dict[str, float]] = {}
    for rec in records:
        tk = str(rec.get("ticker") or "").strip().upper()
        cd = _parse_cd(rec.get("cd_date") or rec.get("completion_date"))
        if not tk or not cd:
            continue
        k = event_key(tk, cd)
        events = rec.get("clinical_events") or rec.get("timeline_events") or []
        scores = []
        for ev in events if isinstance(events, list) else []:
            if not isinstance(ev, dict):
                continue
            s = _float(ev.get("eis_score") or ev.get("impact_score") or ev.get("score"))
            if s is not None:
                scores.append(s)
        by_key[k] = {
            "clinical_event_count": float(len(events) if isinstance(events, list) else 0),
            "eis_score_max": max(scores) if scores else np.nan,
        }

    out = df.copy()
    out["clinical_event_count"] = out["event_key"].map(lambda k: by_key.get(k, {}).get("clinical_event_count"))
    out["eis_score_max"] = out["event_key"].map(lambda k: by_key.get(k, {}).get("eis_score_max"))
    return out


def load_unified_catalyst_panel(
    *,
    include_active: bool = True,
    attach_eis: bool = True,
) -> pd.DataFrame:
    """Archived events (with outcomes) + active pipeline markers."""
    archived = load_past_catalyst_events()
    if include_active:
        active = load_active_sim_events()
        if not active.empty:
            archived_keys = set(archived["event_key"]) if not archived.empty else set()
            active_only = active[~active["event_key"].isin(archived_keys)]
            archived = pd.concat([archived, active_only], ignore_index=True)

    if attach_eis:
        archived = attach_clinical_eis(archived)

    return archived.sort_values(["ticker", "completion_date"]).reset_index(drop=True)


def cohort_summary(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        return {"events": 0, "tickers": 0}
    return {
        "events": int(len(df)),
        "tickers": int(df["ticker"].nunique()),
        "archived_events": int((df.get("pipeline_state") == "archived").sum()) if "pipeline_state" in df.columns else int(len(df)),
        "active_events": int((df.get("pipeline_state") == "active").sum()) if "pipeline_state" in df.columns else 0,
        "with_outcome": int(df["run_m30_m3_pct"].notna().sum()) if "run_m30_m3_pct" in df.columns else 0,
        "baseline_success_5pct": float(df["outcome_success_5pct"].mean()) if "outcome_success_5pct" in df.columns else None,
        "baseline_success_10pct": float(df["outcome_success_10pct"].mean()) if "outcome_success_10pct" in df.columns else None,
        "generated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
