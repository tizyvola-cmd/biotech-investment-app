"""Live catalyst cycle alerts for active pipeline / open-book tickers."""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Literal

import pandas as pd

from .pattern_library import (
    load_library,
    pattern_from_dict,
    pattern_matches,
    _resolve_thresholds,
)
from .supernova_bridge import load_unified_catalyst_panel

logger = logging.getLogger(__name__)

CyclePhase = Literal["pre_volume_watch", "dump_entry", "exhaustion_exit"]
Confidence = Literal["high", "medium", "low", "research"]

ROOT = Path(__file__).resolve().parents[2]


def _normalize_cd_for_key(cd: Any) -> str:
    s = str(cd or "").strip()
    if not s or s in ("—", "-"):
        return "—"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    import re

    m = re.match(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$", s[:10])
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return s[:10] if len(s) >= 10 else s


def _row_key(ticker: str, cd: Any) -> str:
    return f"{ticker.strip().upper()}|{_normalize_cd_for_key(cd)}"


def _float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _load_histlib_rows() -> dict[str, Any]:
    try:
        from prediction.investment_sim_outcomes import _load_histlib
    except ImportError:
        return {}
    doc = _load_histlib()
    rows = doc.get("rows") if isinstance(doc, dict) else None
    return rows if isinstance(rows, dict) else {}


def _best_histlib_snapshot(
    ticker: str,
    completion_date: str,
    *,
    rows: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rows = rows if rows is not None else _load_histlib_rows()
    tk = ticker.strip().upper()
    cd = str(completion_date or "").strip()[:10]
    key = f"{tk}|{cd}" if cd else ""
    blob = rows.get(key) if key else None
    if blob is None:
        # Nearest same-ticker CD key (active pipeline CD may not exist in histlib yet).
        candidates = sorted(k for k in rows if k.startswith(f"{tk}|"))
        if cd:
            candidates = sorted(candidates, key=lambda k: abs(len(k) - len(key)))
        if candidates:
            blob = rows.get(candidates[-1])
    if not isinstance(blob, dict):
        return {}

    snaps = blob.get("snapshots") if isinstance(blob.get("snapshots"), dict) else {}
    for off in ("T-10", "T-7", "T-5", "T-3", "T-1", "T+1"):
        s = snaps.get(off)
        if isinstance(s, dict) and s.get("slope_20d") is not None:
            out = dict(s)
            out["asof"] = s.get("close_asof_date") or out.get("asof")
            out["source_offset"] = off
            return out
    return {}


def _load_histlib_slope_indices() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    try:
        from prediction.investment_sim_outcomes import _build_slope_indices, _load_histlib
    except ImportError:
        return {}, {}
    return _build_slope_indices(_load_histlib())


def _snapshot_for_ticker_cd(
    ticker: str,
    completion_date: str,
    latest_by_ticker: dict[str, dict[str, Any]],
    at_cd_by_key: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    tk = ticker.strip().upper()
    cd = str(completion_date or "").strip()[:10]
    key = f"{tk}|{cd}" if cd else tk
    if key in at_cd_by_key:
        return at_cd_by_key[key]
    if tk in latest_by_ticker:
        return latest_by_ticker[tk]
    return {}


def _load_histlib_context() -> tuple[
    dict[str, Any],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    """Load histlib once per alerts batch (rows + slope indices)."""
    try:
        from prediction.investment_sim_outcomes import _build_slope_indices, _load_histlib
    except ImportError:
        return {}, {}, {}
    histlib = _load_histlib()
    rows = histlib.get("rows") if isinstance(histlib, dict) else None
    row_map = rows if isinstance(rows, dict) else {}
    latest, at_cd = _build_slope_indices(histlib if isinstance(histlib, dict) else {})
    return row_map, latest, at_cd


def build_live_feature_row(
    ticker: str,
    completion_date: str | None,
    *,
    latest_by_ticker: dict[str, dict[str, Any]] | None = None,
    at_cd_by_key: dict[str, dict[str, Any]] | None = None,
    hist_rows: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if latest_by_ticker is None or at_cd_by_key is None:
        hist_rows, latest_by_ticker, at_cd_by_key = _load_histlib_context()

    snap = _best_histlib_snapshot(ticker, completion_date or "", rows=hist_rows)
    if not snap:
        snap = _snapshot_for_ticker_cd(
            ticker,
            completion_date or "",
            latest_by_ticker,
            at_cd_by_key,
        )
    run30 = _float(snap.get("run_up_30d"))
    dump = _float(snap.get("dump_proxy_pct"))
    # Live histlib snapshots rarely store dump_proxy; the dump-entry pattern
    # keys on it. run_up_30d is the same % scale used by live_dump.
    if dump is None:
        dump = run30
    return {
        "ticker": ticker.strip().upper(),
        "completion_date": (completion_date or "")[:10] or None,
        "vol_ratio": _float(snap.get("vol_ratio")),
        "vol_accel": _float(snap.get("vol_accel")),
        "vol_price_div": _float(snap.get("vol_price_div")),
        "slope_5d": _float(snap.get("slope_5d")),
        "slope_20d": _float(snap.get("slope_20d")),
        "slope_45d": _float(snap.get("slope_45d")),
        "run_up_7d": _float(snap.get("run_up_7d")),
        "run_up_30d": run30,
        "rsi_14": _float(snap.get("rsi_14")),
        "exc_slope_vs_XBI": _float(snap.get("exc_slope_vs_XBI")),
        "pcr_options": _float(snap.get("pcr_options")),
        "dump_proxy_pct": dump,
        "feature_asof": snap.get("asof"),
    }


def _match_patterns(
    row: pd.Series,
    library_doc: dict[str, Any],
    cohort_df: pd.DataFrame,
    *,
    include_hypothesis: bool = False,
) -> list[dict[str, Any]]:
    patterns = [pattern_from_dict(p) for p in library_doc.get("patterns") or []]
    allowed = ("confirmed", "emerging") + (("hypothesis",) if include_hypothesis else ())
    patterns = [p for p in patterns if p.status in allowed]

    alerts: list[dict[str, Any]] = []
    for pat in patterns:
        resolved = _resolve_thresholds(pat, cohort_df)
        if pattern_matches(row, resolved):
            lift = pat.stats.get("lift_vs_baseline")
            n = pat.stats.get("n_match") or 0
            conf: Confidence = "research"
            if pat.status == "confirmed" and n >= 20 and lift and lift >= 2.0:
                conf = "high"
            elif pat.status == "confirmed" and lift and lift >= 1.3:
                conf = "medium"
            elif pat.status == "emerging":
                conf = "low"
            alerts.append(
                {
                    "pattern_id": pat.id,
                    "phase": pat.phase,
                    "pattern_status": pat.status,
                    "name_en": pat.name_en,
                    "name_it": pat.name_it,
                    "confidence": conf,
                    "historical_lift": lift,
                    "historical_n": n,
                    "median_outcome_pct": pat.stats.get("median_outcome_pct"),
                }
            )
    return alerts


def _confidence_rank(c: Confidence) -> int:
    return {"high": 4, "medium": 3, "low": 2, "research": 1}.get(c, 0)


def resolve_primary_cycle(
    matches: list[dict[str, Any]],
    *,
    live_dump: bool = False,
) -> dict[str, Any] | None:
    if not matches and not live_dump:
        return None

    pre_vol = [
        m
        for m in matches
        if m.get("phase") == "pre_volume_watch"
        and m.get("pattern_status") in ("confirmed", "emerging")
    ]
    dump_pat = [
        m
        for m in matches
        if m.get("phase") == "dump_entry" and m.get("pattern_status") in ("confirmed", "emerging")
    ]
    exh = [
        m
        for m in matches
        if m.get("phase") == "exhaustion_exit"
        and m.get("pattern_status") in ("confirmed", "emerging")
    ]

    if exh:
        best = max(exh, key=lambda m: (_confidence_rank(m.get("confidence", "research")), m.get("historical_lift") or 0))
        return {
            "phase": "exhaustion_exit",
            "confidence": best.get("confidence", "medium"),
            "primary_pattern_id": best.get("pattern_id"),
            "label_en": "Best sell",
            "label_it": "Best sell",
            "reason_en": best.get("name_en"),
            "reason_it": best.get("name_it"),
        }

    if (dump_pat or live_dump) and pre_vol:
        best_pre = max(pre_vol, key=lambda m: m.get("historical_lift") or 0)
        conf: Confidence = "medium" if live_dump and dump_pat else "low"
        if best_pre.get("confidence") == "high":
            conf = "high"
        return {
            "phase": "dump_entry",
            "confidence": conf,
            "primary_pattern_id": best_pre.get("pattern_id"),
            "label_en": "Best buy",
            "label_it": "Best buy",
            "reason_en": (
                f"{best_pre.get('name_en')} + post-dump"
                if live_dump
                else str(best_pre.get("name_en"))
            ),
            "reason_it": (
                f"{best_pre.get('name_it')} + post-dump"
                if live_dump
                else str(best_pre.get("name_it"))
            ),
        }

    if pre_vol:
        best = max(pre_vol, key=lambda m: (_confidence_rank(m.get("confidence", "research")), m.get("historical_lift") or 0))
        return {
            "phase": "pre_volume_watch",
            "confidence": best.get("confidence", "medium"),
            "primary_pattern_id": best.get("pattern_id"),
            "label_en": "Early setup",
            "label_it": "Setup iniziale",
            "reason_en": best.get("name_en"),
            "reason_it": best.get("name_it"),
        }

    if live_dump:
        return {
            "phase": "dump_entry",
            "confidence": "low",
            "primary_pattern_id": None,
            "label_en": "Buy dip (weak)",
            "label_it": "Buy su dip (debole)",
            "reason_en": "Price drawdown — possible dip entry, pattern not confirmed yet",
            "reason_it": "Drawdown prezzo — possibile buy su dip, pattern non ancora confermato",
        }

    return None


def build_cycle_alert_for_ticker(
    ticker: str,
    completion_date: str | None,
    library_doc: dict[str, Any],
    cohort_df: pd.DataFrame,
    *,
    row_key: str | None = None,
    hist_rows: dict[str, Any] | None = None,
    latest_by_ticker: dict[str, dict[str, Any]] | None = None,
    at_cd_by_key: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    tk = ticker.strip().upper()
    live = build_live_feature_row(
        tk,
        completion_date,
        latest_by_ticker=latest_by_ticker,
        at_cd_by_key=at_cd_by_key,
        hist_rows=hist_rows,
    )
    live_dump = (
        (live.get("dump_proxy_pct") is not None and live["dump_proxy_pct"] <= -8.0)
        or (live.get("run_up_30d") is not None and live["run_up_30d"] <= -8.0)
    )

    # Prefer archived event row when same ticker|CD exists (has dump_proxy etc.).
    event_row = None
    if not cohort_df.empty:
        sub = cohort_df[cohort_df["ticker"] == tk]
        if completion_date:
            sub = sub[sub["completion_date"] == str(completion_date)[:10]]
        if not sub.empty:
            event_row = sub.iloc[-1]

    if event_row is not None:
        row = event_row.copy()
        for k, v in live.items():
            if v is not None:
                row[k] = v
        if not live_dump:
            dp = _float(row.get("dump_proxy_pct"))
            live_dump = dp is not None and dp <= -8.0
    else:
        row = pd.Series(live)

    matches = _match_patterns(row, library_doc, cohort_df)
    primary = resolve_primary_cycle(matches, live_dump=live_dump)

    return {
        "ticker": tk,
        "row_key": row_key,
        "completion_date": completion_date,
        "primary": primary,
        "matches": matches,
        "live_features": live,
        "library_updated_at": library_doc.get("updated_at"),
    }


def build_cycle_alerts(
    items: list[dict[str, Any]],
    library_path: Path | str | None = None,
) -> dict[str, Any]:
    """
    items: [{ticker, completion_date?, row_key?}, ...]
    Returns {updated_at, alerts: {row_key_or_ticker: alert}}
    """
    root = ROOT
    lib_path = Path(library_path) if library_path else root / "data" / "catalyst_pattern_library.json"
    library_doc = load_library(lib_path)
    cohort_df = load_unified_catalyst_panel()
    hist_rows, latest_by_ticker, at_cd_by_key = _load_histlib_context()

    alerts: dict[str, Any] = {}
    for item in items:
        tk = str(item.get("ticker") or "").strip().upper()
        if not tk:
            continue
        cd = item.get("completion_date")
        rk = item.get("row_key") or tk
        alert = build_cycle_alert_for_ticker(
            tk,
            cd,
            library_doc,
            cohort_df,
            row_key=rk,
            hist_rows=hist_rows,
            latest_by_ticker=latest_by_ticker,
            at_cd_by_key=at_cd_by_key,
        )
        alerts[rk] = alert
        # Ticker fallback for UI lookup when row_key date format differs.
        alerts.setdefault(tk, alert)

    return {
        "updated_at": library_doc.get("updated_at"),
        "cohort_summary": library_doc.get("cohort_summary"),
        "alerts": alerts,
    }


def build_alerts_from_sim_snapshot(
    library_path: Path | str | None = None,
    *,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    """All simulation rows, optionally filtered by ticker list."""
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return {"updated_at": None, "alerts": {}}

    doc = json.loads(path.read_text(encoding="utf-8"))
    rows = doc.get("rows") or []
    items: list[dict[str, Any]] = []
    allow = {t.strip().upper() for t in tickers} if tickers else None

    for rec in rows:
        tk = str(rec.get("Ticker") or rec.get("ticker") or "").strip().upper()
        if not tk or (allow and tk not in allow):
            continue
        cd_raw = str(rec.get("Completion Date") or rec.get("completion_date") or "").strip()
        cd_norm = _normalize_cd_for_key(cd_raw)
        rk = _row_key(tk, cd_norm)
        items.append({"ticker": tk, "completion_date": cd_norm if cd_norm != "—" else None, "row_key": rk})

    if allow:
        found = {str(it["ticker"]).upper() for it in items}
        for tk in sorted(allow):
            if tk not in found:
                items.append({"ticker": tk, "completion_date": None, "row_key": tk})

    return build_cycle_alerts(items, library_path)
