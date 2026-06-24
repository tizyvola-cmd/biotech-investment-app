"""Tests for SDS price/enrich loaders."""
from __future__ import annotations

import pickle
from pathlib import Path

import pandas as pd
import pytest

from orchestrator_io_paths import DATA_DIR
from prediction.scoring_data import (
    _pick_close_volume,
    _values_from_pickle_field,
    load_price_series,
    load_xbi_closes,
    load_enrich,
    market_cap_from_enrich,
    _runway_from_enrich,
)

_PRICE_CACHE = Path(DATA_DIR) / "price_cache"


def test_values_from_pandas_series():
    s = pd.Series([1.0, 2.5, None, 3.0])
    assert _values_from_pickle_field(s) == [1.0, 2.5, 3.0]


def test_pick_close_volume_dict_with_series():
    obj = {"close": pd.Series([10.0, 11.0, 12.0]), "volume": pd.Series([100.0, 110.0, 120.0])}
    closes, vols = _pick_close_volume(obj)
    assert len(closes) == 3
    assert len(vols) == 3
    assert closes[0] == 10.0


def test_pick_close_volume_dataframe_xbi():
    df = pd.DataFrame({"XBI": [100.0, 101.0, 102.0]})
    closes, vols = _pick_close_volume(df)
    assert closes == [100.0, 101.0, 102.0]
    assert vols == []


def test_load_vygr_price_series_if_cache_present():
    if not (_PRICE_CACHE / "VYGR_5y_cv.pkl").is_file():
        pytest.skip("VYGR price cache not present")
    closes, vols = load_price_series("VYGR", "5y")
    assert len(closes) >= 20
    assert len(vols) >= 20


def test_load_xbi_closes_if_cache_present():
    has_xbi = any(
        (_PRICE_CACHE / f"{sym}_5y.pkl").is_file() or (_PRICE_CACHE / f"{sym}_5y_cv.pkl").is_file()
        for sym in ("_IDX_XBI", "^XBI", "XBI")
    )
    if not has_xbi:
        pytest.skip("XBI price cache not present")
    closes = load_xbi_closes("5y")
    assert len(closes) >= 20


def test_runway_from_liquidity_score_without_cash():
    assert _runway_from_enrich({"liquidity_score": 1.0}) == 30.0


def test_market_cap_from_enterprise_value():
    assert market_cap_from_enrich({"enterpriseValue": 72_489_560}) == 72_489_560.0
