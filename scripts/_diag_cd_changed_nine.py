#!/usr/bin/env python3
"""Diagnose why 9 CD_CHANGED tickers left Simulation after regen."""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TICKERS = ["CRDF", "GPCR", "GRCE", "ISRG", "KURA", "PFE", "RCUS", "SXTPW", "VERA"]
TODAY = date(2026, 7, 9)
HZ = 120

from data_orchestrator import (  # noqa: E402
    DATA_DIR,
    SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS,
    _build_financial_df_for_orchestrator,
    _compute_sponsor_match,
    _extract_catalyst_dates,
    _norm,
    _pick_best_trusted_catalyst_by_ticker,
    add_modality_column,
    add_sponsor_match_column,
    merge_by_symbol,
)
from simulation_core import build_rows_from_df  # noqa: E402


def main() -> int:
    master_df, clinical_df = merge_by_symbol()
    financial_df = _build_financial_df_for_orchestrator(master_df)
    clinical_df_rich = add_sponsor_match_column(add_modality_column(clinical_df))

    cat_dates = _extract_catalyst_dates(clinical_df, horizon_calendar_days=HZ)
    sim_rows = build_rows_from_df(financial_df, catalyst_dates=cat_dates)
    pre_match = {str(r.get("ticker", "")).upper() for r in sim_rows}

    _tmp = clinical_df_rich.copy()
    _dt_col = "primary_completion_date"
    _tk_col = "ticker"
    _tmp[_dt_col] = pd.to_datetime(_tmp[_dt_col], errors="coerce")
    _horizon = TODAY + timedelta(days=HZ)
    _mask_date = (_tmp[_dt_col].dt.date >= TODAY) & (_tmp[_dt_col].dt.date <= _horizon)
    _mask_spon = _tmp["sponsor_match"].isin(["Exact", "Partial"])

    _match_ok: set[str] = {
        str(v).strip().upper()
        for v in _tmp.loc[_mask_spon, _tk_col].tolist()
        if str(v).strip()
    }

    _yfp = Path(DATA_DIR) / "yf.json"
    if _yfp.exists():
        with open(_yfp, encoding="utf-8") as fh:
            _yfd = json.load(fh)
        _yf_map = {
            _norm(str(it.get("companyName", ""))): str(it.get("symbol", "")).strip().upper()
            for it in _yfd
            if isinstance(it, dict) and it.get("symbol")
        }
        if "query_company" in _tmp.columns:
            for _qcv in _tmp.loc[_mask_spon, "query_company"].dropna().astype(str).str.strip().unique():
                _tk_found = str(_yf_map.get(_norm(_qcv), "") or "").strip().upper()
                if _tk_found:
                    _match_ok.add(_tk_found)

    _fn_col = next(
        (c for c in ["companyName", "name", "longName", "shortName"] if c in financial_df.columns),
        None,
    )
    _sym_col = next((c for c in ["symbol", "ticker", "Ticker"] if c in financial_df.columns), None)
    _fin_nm: dict[str, str] = {}
    if _fn_col and _sym_col:
        _fin_nm = {
            s: n
            for s, n in zip(
                financial_df[_sym_col].astype(str).str.upper(),
                financial_df[_fn_col].astype(str),
            )
            if s
        }
    _all60 = _tmp.loc[_mask_spon]
    for _fsym, _fname in _fin_nm.items():
        if _fsym in _match_ok or not _fname:
            continue
        for _, ar in _all60.iterrows():
            _ls3 = str(ar.get("lead_sponsor", "") or "")
            if _compute_sponsor_match(_fname, _ls3, "", "") in ("Exact", "Partial"):
                _match_ok.add(_fsym)
                break

    picks_hz = _pick_best_trusted_catalyst_by_ticker(
        clinical_df_rich,
        horizon_calendar_days=SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS,
        window="horizon",
        today=TODAY,
    )

    print("DIAG 9 tickers CD_CHANGED")
    print("=" * 90)
    for t in TICKERS:
        reasons: list[str] = []
        in_fin = bool(_sym_col and t in set(financial_df[_sym_col].astype(str).str.upper()))
        in_cat = t in cat_dates
        in_pre = t in pre_match
        in_ok = t in _match_ok
        sub = _tmp[(_tmp[_tk_col].astype(str).str.upper() == t) & _mask_spon & _mask_date]
        direct_rows = len(sub)
        spon_types = sorted(set(sub["sponsor_match"].astype(str).unique())) if len(sub) else []

        if not in_fin:
            reasons.append("ASSENTE in financial_df")
        if not in_cat:
            reasons.append("ASSENTE in extract_catalyst_dates")
        if not in_pre:
            reasons.append("ASSENTE in build_rows_from_df iniziale")
        if not in_ok:
            reasons.append("ASSENTE in match_ok Pass1-2-3")
        if t in picks_hz:
            p = picks_hz[t]
            pick_info = (
                f"pick CD={str(p.get('primary_completion_date', ''))[:10]} "
                f"NCT={p.get('nct_id', '')} match={p.get('sponsor_match', '')}"
            )
        else:
            pick_info = "no horizon pick"
            reasons.append("no trusted horizon pick")

        post = "passa filtri base"
        if reasons:
            post = " | ".join(reasons)

        print(
            f"{t}: fin={in_fin} cat_dates={in_cat} pre_rows={in_pre} "
            f"match_ok={in_ok} direct_hz_rows={direct_rows} spon={spon_types}"
        )
        print(f"    {pick_info}")
        print(f"    BLOCCO: {post}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
