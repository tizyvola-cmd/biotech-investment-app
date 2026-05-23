"""beta / liquidity must reach predict_v5_curve (PRED_V5_FUND_RISK)."""
from __future__ import annotations

from unittest.mock import patch

from prediction.pipeline import predict_v5_q50_offsets
from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_passes_beta_and_liquidity(mock_curve):
    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-1.0, q50=0.0, q95=1.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")
    row = {"beta": 1.8, "liquidity_score": 0.35, "model_dm7_pct": 1.0}
    predict_v5_q50_offsets(row)
    _kw = mock_curve.call_args.kwargs
    assert _kw.get("beta") == 1.8
    assert _kw.get("liquidity_score") == 0.35
