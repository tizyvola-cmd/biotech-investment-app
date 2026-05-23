"""Shared mocks for prediction.pipeline offline tests."""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pandas as pd

from prediction.market_data import OptionsSignalsResult
from prediction.reconcile import ReconcileOutcome
from prediction.types import PrecatFitResult


def future_sim_row(
    ticker: str = "TSTX",
    *,
    days_ahead: int = 60,
    sponsor_match: str = "exact",
    phase: str = "Phase 3",
) -> dict:
    cd = (date.today() + timedelta(days=days_ahead)).isoformat()
    return {
        "ticker": ticker,
        "completion_date": cd,
        "sponsor_match": sponsor_match,
        "phase": phase,
    }


def make_close_vol_series(
    n: int = 65,
    *,
    start_price: float = 10.0,
    daily_return: float = 0.002,
) -> tuple[pd.Series, pd.Series]:
    """Business-day close + volume series ending today."""
    idx = pd.bdate_range(end=date.today(), periods=n)
    prices = [
        start_price * ((1.0 + daily_return) ** i) for i in range(len(idx))
    ]
    close = pd.Series(prices, index=idx, dtype=float)
    vol = pd.Series(
        [1_000_000 + i * 1000 for i in range(len(idx))], index=idx, dtype=float
    )
    return close, vol


def default_orch_mock() -> MagicMock:
    orch = MagicMock()
    orch._VERSIONS = [
        "v1_momentum",
        "v2_signals",
        "v3_ensemble",
        "v4_options",
    ]
    orch._simulation_m2_pool_metrics.return_value = {}
    orch._posthoc_regression_enabled.return_value = False
    orch._mag_bucket_enabled.return_value = False
    orch._mag_bucket_bundle_active.return_value = False
    orch._v4_apply_adaptive_direction.side_effect = lambda d, _ph: d
    orch._clinical_prediction_overlay.side_effect = (
        lambda d, *_a, **_k: (d, 0, "")
    )
    orch._pick_empirical_curve_from_precatalyst_shape.return_value = (
        "neutral",
        {},
    )
    orch._predict_empirical_curve_cat.return_value = {"pred_pct": None, "rel_pct": None}
    orch._model_metric_dict_from_ensemble_signals.return_value = {}
    orch._model_accuracy_metrics_eligible.return_value = False
    orch.model_input_applicability_report.return_value = {}
    orch._direction_for_version.return_value = "↑ Crescita lieve"
    orch._try_blend_pred_dm10_30_60.side_effect = (
        lambda _close, _cat, dm10, dm30, dm60, **_k: (dm10, dm30, dm60, {})
    )
    return orch


def patch_pipeline_orch(orch: MagicMock | None = None):
    orch = orch or default_orch_mock()
    return patch("prediction.pipeline._orch", return_value=orch)


def patch_pipeline_offline(
    orch: MagicMock | None = None,
    *,
    closes: dict | None = None,
    volumes: dict | None = None,
    xbi: pd.Series | None = None,
):
    """Patch orch batch fetch + calib + options + seq calib for offline runs."""
    orch = orch or default_orch_mock()
    close_s, vol_s = make_close_vol_series()
    closes = closes if closes is not None else {"TSTX": close_s}
    volumes = volumes if volumes is not None else {"TSTX": vol_s}
    if xbi is None:
        xbi_idx = pd.bdate_range(end=date.today(), periods=65)
        xbi = pd.Series(
            [100.0 + i * 0.05 for i in range(len(xbi_idx))], index=xbi_idx
        )

    orch._yf_batch_close_vol.return_value = (closes, volumes)
    orch._yf_batch_close.side_effect = lambda syms, *_a, **_k: (
        {"^XBI": xbi} if "^XBI" in syms else {s: closes.get(s, close_s) for s in syms}
    )

    opts = OptionsSignalsResult(
        {"pcr": 1.1, "exp_move_pct": 15.0},
        ok=True,
        error=None,
    )

    cfg = MagicMock()
    cfg.pred_curve_seq_calib = False
    cfg.pred_require_options = False
    cfg.pred_require_price = True
    cfg.orch_options_workers_parallel = False
    cfg.price_tail_trim_days = 120

    patches = [
        patch("prediction.pipeline.get_config", return_value=cfg),
        patch_pipeline_orch(orch),
        patch("prediction.pipeline.calib_load", return_value=[]),
        patch("prediction.pipeline.calib_bias", return_value={
            "n": 0, "d3": 0, "d5": 0, "d10": 0, "d30": 0,
        }),
        patch("prediction.pipeline.options_signals", return_value=opts),
        patch(
            "prediction.pipeline.pred_curve_seq_apply_to_predictions",
        ),
        patch(
            "prediction.pipeline.fit_precat_from_pairs",
            return_value=PrecatFitResult(
                best_name="Lineare",
                best_r2=0.85,
                best_type="lin",
                best_coeffs=[0.1, 0.0],
                model_dm60_pct=12.5,
                model_dm30_pct=8.0,
                model_dm10_pct=4.0,
                d30_pct=5.0,
                d10_pct=2.0,
                d5_pct=1.0,
                d3_pct=0.5,
            ),
        ),
        patch(
            "prediction.pipeline.reconcile_direction_and_curve",
            side_effect=lambda dr, pcts: ReconcileOutcome(
                direction_result=dr,
                model_pcts=pcts,
            ),
        ),
    ]
    return orch, patches
