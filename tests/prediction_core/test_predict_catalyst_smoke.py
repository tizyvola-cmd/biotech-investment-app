"""Smoke tests for predict_catalyst (mocked pipeline, no network)."""
from __future__ import annotations

from unittest.mock import patch

from prediction.pipeline import predict_catalyst
from prediction.types import PredictionRunConfig


def test_predict_catalyst_returns_pipeline_structure() -> None:
    fake = {
        "ABC|2099-12-31": {
            "direction": "↑ Crescita lieve",
            "model_dm60_pct": 10.0,
            "data_quality_score": 0.85,
            "data_quality": {"quality_score": 0.85},
        },
        "ABC": {
            "direction": "↑ Crescita lieve",
            "model_dm60_pct": 10.0,
        },
    }
    row = {
        "ticker": "ABC",
        "completion_date": "2099-12-31",
        "sponsor_match": "exact",
        "phase": "Phase 3",
    }
    with patch(
        "prediction.pipeline.compute_price_predictions",
        return_value=fake,
    ) as mock_compute:
        out = predict_catalyst([row], config=PredictionRunConfig())

    mock_compute.assert_called_once()
    assert out is fake
    assert "ABC" in out
    entry = out["ABC|2099-12-31"] if "ABC|2099-12-31" in out else out["ABC"]
    assert entry["direction"].startswith("↑")
    assert entry["model_dm60_pct"] == 10.0
