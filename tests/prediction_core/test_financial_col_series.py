"""Helpers for Financial sheet column access (duplicate names, display cols)."""
from __future__ import annotations

import pandas as pd

from data_orchestrator import (
    _apply_col_order,
    _financial_column_series,
    _financial_numeric_series,
)


def test_apply_col_order_no_duplicate_columns():
    df = pd.DataFrame(
        {
            "symbol": ["AAA"],
            "current_ratio": [1.5],
            "quick_ratio": [1.2],
            "marketCap": [1e9],
        }
    )
    out = _apply_col_order(df)
    assert list(out.columns).count("current_ratio") == 1
    assert list(out.columns).count("quick_ratio") == 1


def test_financial_column_series_first_on_duplicate_names():
    df = pd.DataFrame([[1.0, 9.0]], columns=["current_ratio", "current_ratio"])
    s = _financial_column_series(df, "current_ratio")
    assert isinstance(s, pd.Series)
    assert s.iloc[0] == 1.0


def test_financial_numeric_series_skips_display_columns():
    df = pd.DataFrame(
        {
            "liquidita_fy": ["CR 1.44 | QR 0.90"],
            "beta": [1.05],
            "marketCap": [2e9],
        }
    )
    assert _financial_numeric_series(df, "liquidita_fy") is None
    beta = _financial_numeric_series(df, "beta")
    assert beta is not None
    assert float(beta.iloc[0]) == 1.05


def test_financial_numeric_series_coerces_numbers():
    df = pd.DataFrame({"marketCap": ["1000000", "2000000"]})
    s = _financial_numeric_series(df, "marketCap")
    assert s is not None
    assert s.notna().all()
