"""Tests for prediction.market_data helpers."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd

from prediction.market_data import (
    OptionsSignalsResult,
    close_series_from_raw,
    options_signals,
)


def test_options_signals_failure_returns_structured_result():
    with patch("yfinance.Ticker", side_effect=RuntimeError("offline")):
        res = options_signals("XYZ", 10.0)
    assert isinstance(res, OptionsSignalsResult)
    assert res.ok is False
    assert res.error
    assert res.signals == {}


def test_close_series_from_raw_simple_column():
    raw = pd.DataFrame({"Close": [1.0, 2.0, 3.0]})
    ser = close_series_from_raw(raw, "ABC")
    assert len(ser) == 3
