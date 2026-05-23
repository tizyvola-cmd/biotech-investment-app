"""Smoke tests for prediction.pipeline (mocked market path)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from prediction.pipeline import compute_price_predictions, predict_catalyst
from prediction.types import PredictionRunConfig


def test_predict_catalyst_empty_rows():
    assert compute_price_predictions([]) == {}
    assert predict_catalyst([], config=PredictionRunConfig()) == {}


@patch("prediction.pipeline._orch")
def test_compute_price_predictions_no_future_events(mock_orch_fn):
    orch = MagicMock()
    mock_orch_fn.return_value = orch
    orch._calib_load.return_value = []
    orch._calib_bias.return_value = {"n": 0, "d3": 0, "d5": 0, "d10": 0, "d30": 0}
    orch._simulation_m2_pool_metrics.return_value = {}
    orch._posthoc_regression_enabled.return_value = False
    orch._mag_bucket_enabled.return_value = False
    orch._ensemble_phase_num.return_value = 3
    orch._normalize_completion_date_ca.return_value = None

    rows = [{"ticker": "FAKE", "completion_date": "2099-01-01", "phase": "Phase 3"}]
    with patch("prediction.pipeline.pd", create=True):
        out = compute_price_predictions(rows)
    assert out == {}


def test_import_predict_catalyst_fast():
    from prediction.pipeline import predict_catalyst as pc

    assert callable(pc)
