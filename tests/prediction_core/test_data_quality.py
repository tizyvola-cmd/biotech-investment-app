"""Tests for prediction data quality reporting."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from prediction.data_quality import (
    DataQualityReport,
    build_data_quality_report,
    format_dq_adj_tag,
)
from prediction.market_data import OptionsSignalsResult, options_signals


def test_options_failure_ok_false_and_missing_options():
    with patch("yfinance.Ticker", side_effect=RuntimeError("offline")):
        res = options_signals("XYZ", 10.0)
    assert isinstance(res, OptionsSignalsResult)
    assert res.ok is False
    assert res.error
    assert res.signals == {}

    dq = build_data_quality_report(
        price_ok=True,
        volume_ok=True,
        xbi_ok=True,
        options_ok=res.ok,
        hist_5y_ok=True,
        options_error=res.error,
    )
    assert any("opzioni" in m for m in dq.missing)


def test_partial_data_quality_score_between_zero_and_one():
    dq = build_data_quality_report(
        price_ok=True,
        volume_ok=False,
        xbi_ok=False,
        options_ok=False,
        hist_5y_ok=True,
    )
    assert 0.0 < dq.quality_score < 1.0
    assert dq.price_ok
    assert not dq.options_ok


def test_format_dq_adj_tag_max_length():
    dq = build_data_quality_report(
        price_ok=False,
        volume_ok=False,
        xbi_ok=False,
        options_ok=False,
        hist_5y_ok=False,
    )
    tag = format_dq_adj_tag(dq, max_len=80)
    assert tag.startswith("[DQ:")
    assert len(tag) <= 80


def test_data_quality_report_to_dict():
    dq = DataQualityReport(price_ok=True, volume_ok=True, quality_score=0.5)
    d = dq.to_dict()
    assert d["price_ok"] is True
    assert "quality_score" in d


def test_options_no_expirations():
    mock_t = MagicMock()
    mock_t.options = []
    with patch("yfinance.Ticker", return_value=mock_t):
        res = options_signals("ABC", 5.0)
    assert res.ok is False
    assert "scadenza" in (res.error or "").lower() or res.error
