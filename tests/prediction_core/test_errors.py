"""Tests for prediction.errors central helper."""
from __future__ import annotations

import json
import logging
from unittest.mock import patch

import pytest

from past_pred_io import load_past_pred_document
from prediction.errors import (
    ErrorAccumulator,
    empty_result_with_error,
    log_prediction_error,
    result_with_errors,
)


def test_error_accumulator_collects_entries():
    acc = ErrorAccumulator()
    acc.record("step_a", ValueError("bad value"))
    assert len(acc.entries) == 1
    assert acc.entries[0]["context"] == "step_a"
    assert "bad value" in acc.entries[0]["message"]
    assert acc.entries[0]["timestamp"]
    assert acc.as_strings() == ["step_a: bad value"]
    assert acc.partial is True


def test_result_with_errors_merges_into_dict():
    acc = ErrorAccumulator()
    acc.record("fetch", RuntimeError("offline"))
    out = result_with_errors({"ticker": "X"}, acc)
    assert out["ticker"] == "X"
    assert out["partial"] is True
    assert any("fetch" in e for e in out["errors"])


def test_result_with_errors_noop_when_empty():
    assert result_with_errors({"a": 1}, ErrorAccumulator()) == {"a": 1}


def test_log_prediction_error_does_not_crash(caplog, monkeypatch):
    monkeypatch.delenv("PRED_STRICT_ERRORS", raising=False)
    with caplog.at_level(logging.WARNING, logger="prediction"):
        log_prediction_error("unit_test", ValueError("probe"))
    assert any("unit_test" in r.message for r in caplog.records)


def test_strict_mode_reraises(monkeypatch):
    from prediction import config as cfg

    cfg.reset_config()
    monkeypatch.setenv("PRED_STRICT_ERRORS", "1")
    with pytest.raises(ValueError, match="strict"):
        log_prediction_error("strict_ctx", ValueError("strict"))
    cfg.reset_config()


def test_empty_result_with_error_structure():
    from dataclasses import replace

    from prediction import config as cfg

    cfg.reset_config()
    loose = replace(cfg.get_config(reload=True), pred_strict_errors=False)
    with patch("prediction.errors.get_config", return_value=loose):
        out = empty_result_with_error("ctx", ValueError("x"), base={"rows": {}})
    cfg.reset_config()
    assert out["_error"]
    assert out["partial"] is True
    assert out["rows"] == {}


def test_load_past_pred_document_invalid_json_logs_and_marks_partial(tmp_path, caplog, monkeypatch):
    monkeypatch.delenv("PRED_STRICT_ERRORS", raising=False)
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    with caplog.at_level(logging.WARNING, logger="prediction"):
        doc = load_past_pred_document(str(bad))
    assert doc["rows"] == {}
    assert doc.get("_error")
    assert doc.get("partial") is True
    assert doc.get("errors")


def test_refresh_report_extend_report():
    from prediction.errors import ErrorAccumulator
    from prediction.refresh_coordinator import RefreshReport

    acc = ErrorAccumulator()
    acc.record("t", RuntimeError("e"))
    r = RefreshReport(
        refresh_kind="guida",
        records_in=0,
        records_out=0,
        cohort_size=0,
        nct_filter_applied=False,
    )
    acc.extend_report(r)
    assert r.partial is True
    assert r.errors
