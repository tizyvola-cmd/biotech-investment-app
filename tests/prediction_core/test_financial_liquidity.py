"""FY liquidity ratios and Financial row helpers."""
from __future__ import annotations

import json
import os
import tempfile

import pandas as pd
import pytest

from prediction.financial_liquidity import (
    compute_liquidity_ratios,
    fetch_liquidity_yfinance,
    financial_row_liquidity_keys,
    format_liquidity_display,
    liquidity_score,
    load_liquidity_from_enrich_cache,
    merge_liquidity_dict,
    parse_balance_sheet_values,
    parse_yfinance_balance_sheet,
)


def test_compute_liquidity_ratios_basic():
    out = compute_liquidity_ratios(
        current_assets=200.0,
        current_liabilities=100.0,
        inventory=30.0,
        cash=40.0,
        marketable_securities=10.0,
        fy_date="2024-12-31",
    )
    assert out["current_ratio"] == 2.0
    assert out["quick_ratio"] == 1.7
    assert out["cash_ratio"] == 0.5
    assert out["liquidity_fy_date"] == "2024-12-31"
    assert 0.0 < out["liquidity_score"] <= 1.0


def test_liquidity_score_neutral_when_no_ratios():
    assert liquidity_score(None, None, None) == 1.0


def test_format_liquidity_display_cr_qr():
    text = format_liquidity_display(current_ratio=1.44, quick_ratio=0.9)
    assert text == "CR 1.44 | QR 0.90"


def test_format_liquidity_display_from_row():
    row = {"current_ratio": 2.1, "quick_ratio": None, "cash_ratio": None}
    assert format_liquidity_display(row=row) == "CR 2.10"


def test_parse_balance_sheet_values_labels():
    row_values = {
        "Total Current Assets": 500.0,
        "Total Current Liabilities": 250.0,
        "Inventory": 50.0,
        "Cash And Cash Equivalents": 80.0,
    }
    out = parse_balance_sheet_values(row_values, fy_date="2023-06-30")
    assert out["current_ratio"] == 2.0
    assert out["quick_ratio"] == 1.8


def test_parse_balance_sheet_ignores_bare_assets_row():
    row_values = {
        "Assets": 10_000.0,
        "Current Assets": 200.0,
        "Current Liabilities": 100.0,
    }
    out = parse_balance_sheet_values(row_values, fy_date="2024-12-31")
    assert out["current_ratio"] == 2.0


def test_merge_liquidity_dict_sets_fy_date_alias():
    target: dict = {"beta": 1.2}
    liq = {
        "current_ratio": 1.5,
        "liquidity_fy_date": "2024-12-31",
    }
    merge_liquidity_dict(target, liq)
    assert target["current_ratio"] == 1.5
    assert target["fy_date"] == "2024-12-31"
    assert target["liquidity_fy_date"] == "2024-12-31"
    assert target["beta"] == 1.2


def test_load_liquidity_from_enrich_cache_fy_date_alias():
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "HURA.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {"beta": 0.85, "current_ratio": 3.2, "fy_date": "2024-12-31"},
                fh,
            )
        loaded = load_liquidity_from_enrich_cache("HURA", cache_dir=tmp)
        assert loaded is not None
        assert loaded["current_ratio"] == 3.2
        assert loaded["liquidity_fy_date"] == "2024-12-31"


def test_financial_row_liquidity_keys_includes_beta_and_display():
    row = {
        "symbol": "HURA",
        "beta": 0.9,
        "liquidita_fy": "CR 1.44 | QR 0.90",
        "current_ratio": 1.44,
        "liquidity_score": 0.8,
    }
    keys = financial_row_liquidity_keys(row)
    assert keys["beta"] == 0.9
    assert keys["liquidita_fy"] == "CR 1.44 | QR 0.90"
    assert keys["current_ratio"] == 1.44
    assert "quick_ratio" not in keys


def test_merge_liquidity_into_financial_df_from_cache(monkeypatch):
    from data_orchestrator import _merge_liquidity_into_financial_df

    with tempfile.TemporaryDirectory() as tmp:
        enrich_cache = os.path.join(tmp, "enrich_cache")
        os.makedirs(enrich_cache, exist_ok=True)
        with open(os.path.join(enrich_cache, "TST.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "current_ratio": 1.6,
                    "quick_ratio": 1.1,
                    "fy_date": "2024-12-31",
                },
                fh,
            )
        monkeypatch.setattr("data_orchestrator.DATA_DIR", tmp)

        df = pd.DataFrame([{"symbol": "TST", "beta": 1.05}])
        out = _merge_liquidity_into_financial_df(df, fetch_api=False)
        row = out.iloc[0]
        assert row["current_ratio"] == 1.6
        assert "CR 1.60" in str(row["liquidita_fy"])
        assert row["beta"] == 1.05


def test_merge_liquidity_overwrites_insane_financial_df_cr(monkeypatch):
    from data_orchestrator import _merge_liquidity_into_financial_df

    with tempfile.TemporaryDirectory() as tmp:
        enrich_cache = os.path.join(tmp, "enrich_cache")
        os.makedirs(enrich_cache, exist_ok=True)
        with open(os.path.join(enrich_cache, "HURA.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "current_ratio": 0.78,
                    "quick_ratio": 0.78,
                    "fy_date": "2025-12-31",
                },
                fh,
            )
        monkeypatch.setattr("data_orchestrator.DATA_DIR", tmp)
        df = pd.DataFrame(
            [{"symbol": "HURA", "current_ratio": 45.0, "quick_ratio": 45.0, "beta": 1.0}]
        )
        out = _merge_liquidity_into_financial_df(df, fetch_api=False)
        row = out.iloc[0]
        assert row["current_ratio"] == pytest.approx(0.78, rel=1e-3)
        assert "CR 0.78" in str(row["liquidita_fy"])


class _FakeSeries:
    def __init__(self, data: dict) -> None:
        self._data = data

    @property
    def index(self):
        return list(self._data.keys())

    def loc(self, key):
        return self._data[key]


class _FakeBalanceSheet:
    empty = False
    columns = [type("Col", (), {"__str__": lambda self: "2024-12-31"})()]

    def __getitem__(self, _col):
        return _FakeSeries(
            {
                "Total Current Assets": 300.0,
                "Total Current Liabilities": 150.0,
                "Inventory": 20.0,
            }
        )


def test_parse_yfinance_balance_sheet_mock():
    out = parse_yfinance_balance_sheet(_FakeBalanceSheet())
    assert out["current_ratio"] == 2.0
    assert out["quick_ratio"] == pytest.approx(280.0 / 150.0)


def test_fetch_liquidity_yfinance_uses_balance_sheet():
    class _Ticker:
        balance_sheet = _FakeBalanceSheet()

    class _Yf:
        def Ticker(self, _sym):
            return _Ticker()

    out = fetch_liquidity_yfinance("TST", yf_module=_Yf())
    assert out["current_ratio"] == 2.0
