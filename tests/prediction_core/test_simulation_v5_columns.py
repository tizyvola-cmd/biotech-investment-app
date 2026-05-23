"""v5 q50: compute in pred dict; Excel columns only on Accuracy sheet."""
from __future__ import annotations

from unittest.mock import patch

import data_orchestrator as orch
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    predict_v5_q50_offsets,
    simulation_v5_header_for_offset,
)


def test_simulation_headers_no_v5_columns():
    assert simulation_v5_header_for_offset(-60) not in orch.SIMULATION_36_HEADERS
    idx_v4_end = orch.SIMULATION_36_HEADERS.index("Δ% vs Pred−60\nPred\n+7")
    assert orch.SIMULATION_36_HEADERS[idx_v4_end + 1] == "N° K-8\n[CD−finestra SEC]"
    assert orch.SIMULATION_36_HEADERS[idx_v4_end + 2] == "Date K-8\n(+1/+2/+3)"
    assert orch.SIMULATION_36_N == 45
    assert orch.SIM_COL_V4_PRED_HI + 1 == orch.SIM_COL_K8_COUNT
    assert orch.SIM_COL_K8_DATES + 1 == orch.SIM_COL_AFFIDABILITA


def test_accuracy_v5_column_positions():
    assert orch.ACC_COL_V4_PRED_HI == orch.ACC_COL_V5_PRED_LO - 1
    assert orch.ACC_COL_V5_PRED_HI - orch.ACC_COL_V5_PRED_LO + 1 == len(
        SIMULATION_V5_Q50_OFFSETS
    )
    assert orch.ACCURACY_V5_HEADERS[0] == simulation_v5_header_for_offset(-60)
    assert orch.ACCURACY_V5_HEADERS[-1] == simulation_v5_header_for_offset(7)
    assert orch.ACC_COL_HIST_LO == orch.ACC_COL_V5_PRED_HI + 1
    assert orch.ACCURACY_SHEET_N == 51


@patch("prediction.v5.predict_v5_curve")
def test_predict_v5_q50_offsets_returns_eight_values(mock_curve):
    from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution

    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-1.0, q50=float(off) / 10.0, q95=1.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")

    row = {
        "slope_20d": 0.1,
        "run_up_30d": 5.0,
        "vol_20d": 0.02,
        "beta": 1.2,
        "liquidity_score": 0.9,
        "price_series": [10.0, 10.1, 10.2, 10.3, 10.4, 10.5],
    }
    out = predict_v5_q50_offsets(row)
    assert set(out.keys()) == {str(o) for o in SIMULATION_V5_Q50_OFFSETS}
    assert out["-60"] == -6.0
    assert out["4"] == 0.4
    assert out["7"] == 0.7
    mock_curve.assert_called_once()
    _kwargs = mock_curve.call_args.kwargs
    assert _kwargs.get("vol_20d") == 0.02
    assert _kwargs.get("vol_20d") != row.get("vol_ratio")


def test_write_accuracy_row_includes_v5_from_pred_data():
    """Accuracy row path: v5_q50_offsets → seven numeric cells (cols Z–AF)."""
    from openpyxl import Workbook
    from datetime import date

    wb = Workbook()
    ws = wb.active
    ws.title = "Accuracy"
    _today = date.today()
    _cd = _today.replace(year=_today.year + 1)
    _pk = f"TST|{_cd.isoformat()}"
    _filtered = {
        _pk: {
            "ticker": "TST",
            "completion_date": _cd,
            "sponsor_match": "exact",
            "company_name_full": "Test Co",
            "nct_id": "NCT00000001",
            "nct_relation_type": "—",
            "model_dm60_pct": 0.0,
            "model_dm30_pct": 1.0,
            "model_dm10_pct": 1.0,
            "model_dm7_pct": 1.0,
            "model_dm5_pct": 1.0,
            "model_dm3_pct": 1.0,
            "model_d4_pct": 1.0,
            "model_d7_pct": 1.0,
            "price_at_cd": 10.0,
            "close_m60": 10.0,
            "v5_q50_offsets": {str(o): float(o) for o in SIMULATION_V5_Q50_OFFSETS},
        }
    }
    _sim_rows = [
        {
            "ticker": "TST",
            "completion_date": _cd,
            "sponsor_match": "exact",
            "name": "Test Co",
            "nct_id": "NCT00000001",
        }
    ]
    with patch("prediction.config.pred_v5_anchor_q50_v4_enabled", return_value=False):
        orch._write_accuracy_simulation_sheet(
            wb,
            past_pred_pre_relation=_filtered,
            sim_rows=_sim_rows,
            sim_pred_data={},
        )
    ws_acc = wb["Accuracy"]
    _rn = 4
    for i, off in enumerate(SIMULATION_V5_Q50_OFFSETS):
        col = orch.ACC_COL_V5_PRED_LO + i
        cell = ws_acc.cell(row=_rn, column=col)
        assert cell.value == off / 100.0, f"col {col} offset {off}"
