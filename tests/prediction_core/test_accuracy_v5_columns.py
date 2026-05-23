"""Accuracy sheet: v5 q50 columns after v4 Δ% block."""
from __future__ import annotations

from unittest.mock import patch

import data_orchestrator as orch
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    predict_v5_q50_offsets,
    simulation_v5_header_for_offset,
)


def test_accuracy_sheet_column_constants():
    assert orch.ACCURACY_SHEET_N == 51
    assert orch.ACC_COL_V4_PRED_HI == orch.ACC_COL_V5_PRED_LO - 1
    assert orch.ACC_COL_V5_PRED_HI - orch.ACC_COL_V5_PRED_LO + 1 == len(
        SIMULATION_V5_Q50_OFFSETS
    )
    assert orch.ACC_COL_V5_PRED_LO == 28
    assert orch.ACC_COL_V5_PRED_HI == 35
    assert orch.ACC_COL_HIST_LO == 36
    assert orch.ACC_COL_DELTA_HI == 51
    assert orch.ACCURACY_V5_HEADERS[0] == simulation_v5_header_for_offset(-60)
    assert orch.ACCURACY_V5_HEADERS[-1] == simulation_v5_header_for_offset(7)


def test_accuracy_v5_headers_after_v4_plus7():
    _pred_lbls = [
        "Δ% vs Pred−60\nPred\n−60",
        "Δ% vs Pred−60\nPred\n+7",
    ]
    _meta_n = orch.ACCURACY_SHEET_META_N
    _date_n = orch.ACCURACY_SHEET_DATE_N
    _prezzo_n = orch.ACCURACY_SHEET_PREZZO_N
    _v4_n = orch.ACCURACY_SHEET_V4_PRED_N
    v4_end_col = _meta_n + _date_n + _prezzo_n + _v4_n
    assert v4_end_col == orch.ACC_COL_V4_PRED_HI
    assert orch.ACC_COL_V5_PRED_LO == v4_end_col + 1


@patch("prediction.v5.predict_v5_curve")
def test_accuracy_v5_offsets_from_stored_dict(mock_curve):
    mock_curve.return_value = None
    row = {
        "ticker": "TST",
        "v5_q50_offsets": {str(o): float(o) for o in SIMULATION_V5_Q50_OFFSETS},
    }
    out = orch._accuracy_v5_q50_offsets_for_row(row)
    assert out["-60"] == -60.0
    assert out["7"] == 7.0
    mock_curve.assert_not_called()


@patch("data_orchestrator.predict_v5_fan_offsets")
def test_accuracy_v5_offsets_compute_when_missing(mock_pred):
    def _fake_fan(row, **kwargs):
        row["v5_q50_offsets"] = {
            str(o): float(o) / 10.0 for o in SIMULATION_V5_Q50_OFFSETS
        }
        return {}

    mock_pred.side_effect = _fake_fan
    row = {"ticker": "TST", "slope_20d": 0.1, "beta": 1.0}
    out = orch._accuracy_v5_q50_offsets_for_row(row, ser_cache={})
    assert out["-60"] == -6.0
    mock_pred.assert_called_once()


@patch("prediction.v5.predict_v5_curve")
def test_write_accuracy_sheet_includes_v5_cells(mock_curve):
    from prediction.v5.schema import CurveNodeQuantiles, PredictionDistribution
    from openpyxl import Workbook
    from datetime import date

    nodes = {
        off: CurveNodeQuantiles(offset=off, q05=-1.0, q50=float(off), q95=1.0)
        for off in (-60, -30, -10, -7, -5, -3, 0, 4, 7)
    }
    mock_curve.return_value = PredictionDistribution(nodes=nodes, regime="trend")

    wb = Workbook()
    cd = date.today()
    sim_rows = [
        {
            "ticker": "TST",
            "company_name_full": "Test Co",
            "nct_id": "NCT00000001",
            "completion_date": cd,
            "sponsor_match": "exact",
            "nct_relation_type": "—",
            "curr_price": 10.0,
            "beta": 1.0,
        }
    ]
    key = f"TST|{cd.isoformat()}"
    past = {
        key: {
            "ticker": "TST",
            "completion_date": cd,
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
            "v5_fan_offsets": {
                str(o): {"q05": -1.0, "q50": float(o), "q95": 1.0}
                for o in SIMULATION_V5_Q50_OFFSETS
            },
            "v5_q50_offsets": {str(o): float(o) for o in SIMULATION_V5_Q50_OFFSETS},
        }
    }
    with patch("prediction.config.pred_v5_anchor_q50_v4_enabled", return_value=False):
        with patch("prediction.config.pred_v5_excel_fan_enabled", return_value=False):
            orch._write_accuracy_simulation_sheet(
                wb,
                past,
                sim_rows=sim_rows,
                sim_pred_data={},
            )
    ws = wb["Accuracy"]
    hdr_v5_lo = orch.ACC_COL_V5_PRED_LO
    assert ws.cell(row=3, column=hdr_v5_lo).value == simulation_v5_header_for_offset(-60)
    data_row = 4
    for i, off in enumerate(SIMULATION_V5_Q50_OFFSETS):
        cell = ws.cell(row=data_row, column=hdr_v5_lo + i)
        assert cell.value == off / 100.0
    assert ws.cell(row=3, column=orch.ACC_COL_DELTA_HI).value.startswith("Δ%")
    assert ws.cell(row=3, column=orch.ACC_COL_DELTA_HI).value.endswith("T+7")
