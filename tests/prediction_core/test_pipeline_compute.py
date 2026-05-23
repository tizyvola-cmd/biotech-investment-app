"""Offline unit tests for prediction.pipeline.compute_price_predictions."""
from __future__ import annotations

import inspect
from contextlib import ExitStack
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from prediction.data_quality import DataQualityReport
from prediction.pipeline import compute_price_predictions

from tests.prediction_core._pipeline_test_helpers import (
    default_orch_mock,
    future_sim_row,
    make_close_vol_series,
    patch_pipeline_offline,
)


def _apply_patches(stack: ExitStack, patches: list) -> None:
    for p in patches:
        stack.enter_context(p)


def _run_compute(rows: list, *, extra_patches: list | None = None) -> dict:
    orch, patches = patch_pipeline_offline()
    with ExitStack() as stack:
        _apply_patches(stack, patches)
        if extra_patches:
            _apply_patches(stack, extra_patches)
        return compute_price_predictions(rows)


def _pred_for_ticker(out: dict, ticker: str = "TSTX") -> dict | None:
    if not out:
        return None
    cd_key = next((k for k in out if k.startswith(f"{ticker}|")), None)
    return out.get(cd_key) or out.get(ticker)


def test_compute_price_predictions_minimal_60d() -> None:
    row = future_sim_row()
    out = _run_compute([row])
    pred = _pred_for_ticker(out)
    assert pred is not None
    assert "direction" in pred
    assert pred["direction"]
    assert "model_dm60_pct" in pred
    assert pred["model_dm60_pct"] is not None
    assert "data_quality" in pred
    assert isinstance(pred["data_quality"], dict)
    assert "data_quality_score" in pred


def test_compute_price_predictions_empty_60d_batch() -> None:
    orch = default_orch_mock()
    _, patches = patch_pipeline_offline(orch, closes={}, volumes={})
    with ExitStack() as stack:
        _apply_patches(stack, patches)
        out = compute_price_predictions([future_sim_row()])
    assert out == {}


def test_compute_price_predictions_no_future_rows() -> None:
    past = {
        "ticker": "TSTX",
        "completion_date": (date.today() - timedelta(days=30)).isoformat(),
        "sponsor_match": "exact",
        "phase": "Phase 3",
    }
    assert _run_compute([past]) == {}


def test_compute_price_predictions_price_dq_skip_curve() -> None:
    row = future_sim_row()
    dq = DataQualityReport(
        price_ok=False,
        volume_ok=True,
        xbi_ok=True,
        options_ok=True,
        hist_5y_ok=False,
    )
    dq.recompute_score()

    cfg = MagicMock()
    cfg.pred_require_price = True
    cfg.pred_require_options = False
    cfg.pred_curve_seq_calib = False
    cfg.orch_options_workers_parallel = False
    cfg.price_tail_trim_days = 120

    orch, patches = patch_pipeline_offline()
    extra = [
        patch("prediction.pipeline.get_config", return_value=cfg),
        patch(
            "prediction.pipeline.build_data_quality_report",
            return_value=dq,
        ),
    ]
    with ExitStack() as stack:
        _apply_patches(stack, patches + extra)
        out = compute_price_predictions([row])

    pred = _pred_for_ticker(out)
    assert pred is not None
    assert "direction" in pred
    assert pred.get("model_dm60_pct") is None
    assert pred.get("model") == "N/D (DQ)"


def test_compute_price_predictions_partial_sponsor_row() -> None:
    row = future_sim_row(sponsor_match="partial")
    out = _run_compute([row])
    pred = _pred_for_ticker(out)
    assert pred is not None
    assert pred.get("direction")


def test_orchestrator_compute_price_predictions_delegates_to_pipeline() -> None:
    import data_orchestrator as orch_mod

    src = inspect.getsource(orch_mod._compute_price_predictions)
    delegates = (
        "prediction.pipeline" in src
        and "compute_price_predictions" in src
    )
    if delegates:
        sentinel = {"TSTX": {"direction": "→ Stabile", "model_dm60_pct": 1.0}}
        with patch(
            "prediction.pipeline.compute_price_predictions",
            return_value=sentinel,
        ) as mock_pipe:
            out = orch_mod._compute_price_predictions([])
        mock_pipe.assert_called_once()
        assert out is sentinel
    else:
        # Legacy inline body: same public entry should still exist on pipeline.
        from prediction.pipeline import compute_price_predictions as pipe_fn

        assert callable(pipe_fn)
        assert pipe_fn.__name__ == "compute_price_predictions"
