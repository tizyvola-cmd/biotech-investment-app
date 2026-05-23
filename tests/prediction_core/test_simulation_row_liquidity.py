"""Simulation row dict: liquidity FY + beta from financial_df."""
from __future__ import annotations

import pandas as pd

from data_orchestrator import SIMULATION_36_HEADERS
from simulation_core import build_rows_from_df, merge_sim_row_liquidity_fields


def test_simulation_headers_include_liquidity_columns():
    assert "Liquidità (FY)" in SIMULATION_36_HEADERS
    assert "Beta (5Y vs mercato)" in SIMULATION_36_HEADERS
    assert SIMULATION_36_HEADERS.index("Liquidità (FY)") == 12
    assert SIMULATION_36_HEADERS.index("Beta (5Y vs mercato)") == 13


def test_build_rows_from_df_includes_liquidity_and_beta():
    df = pd.DataFrame(
        [
            {
                "symbol": "TST",
                "currentPrice": 10.0,
                "beta": 1.1,
                "current_ratio": 2.0,
                "quick_ratio": 1.5,
                "liquidita_fy": "CR 2.00 | QR 1.50",
                "liquidity_score": 0.85,
            }
        ]
    )
    rows = build_rows_from_df(df)
    assert len(rows) == 1
    r = rows[0]
    assert r["beta"] == 1.1
    assert r["liquidity_score"] == 0.85
    assert r["current_ratio"] == 2.0
    assert "CR 2.00" in str(r["liquidita_fy"])


def test_merge_sim_row_liquidity_fields_formats_when_display_missing():
    row = {"ticker": "X", "beta": None}
    fin = {"current_ratio": 1.8, "quick_ratio": 1.2, "beta": 0.95}
    merge_sim_row_liquidity_fields(row, fin)
    assert row["beta"] == 0.95
    assert row["current_ratio"] == 1.8
    assert "CR 1.80" in str(row["liquidita_fy"])
