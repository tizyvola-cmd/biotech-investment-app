"""Replace moved blocks in data_orchestrator with thin wrappers."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORCH = ROOT / "data_orchestrator.py"
lines = ORCH.read_text(encoding="utf-8").splitlines(keepends=True)

SEQ_START, SEQ_END = 8898, 9312  # knot + apply (0-based end exclusive)
COMPUTE_START, COMPUTE_END = 11507, 12812

seq_wrappers = '''# _pred_curve_seq_* knot helpers + apply → prediction.seq_calib (Phase B)
def _pred_curve_close_cal(close_series, cd, cal_off: int):
    from prediction.seq_calib import pred_curve_close_cal
    return pred_curve_close_cal(close_series, cd, cal_off)


def _pred_curve_trade_date_at_offset(close_series, cd, cal_off: int):
    from prediction.seq_calib import pred_curve_trade_date_at_offset
    return pred_curve_trade_date_at_offset(close_series, cd, cal_off)


def _pred_curve_series_upto_trade_date(ser, end_trade_date):
    from prediction.seq_calib import pred_curve_series_upto_trade_date
    return pred_curve_series_upto_trade_date(ser, end_trade_date)


def _pred_curve_knot_metrics_asof(close_upto, vol_upto, xbi_upto):
    from prediction.seq_calib import pred_curve_knot_metrics_asof
    return pred_curve_knot_metrics_asof(close_upto, vol_upto, xbi_upto)


def _pred_curve_seq_apply_to_predictions(
    result: dict,
    closes_long: dict,
    volumes_long: dict | None,
    xbi_long,
    *,
    today,
    financial_df=None,
) -> None:
    from prediction.seq_calib import pred_curve_seq_apply_to_predictions
    return pred_curve_seq_apply_to_predictions(
        result,
        closes_long,
        volumes_long,
        xbi_long,
        today=today,
        financial_df=financial_df,
    )


'''

compute_wrapper = '''def _compute_price_predictions(sim_rows: list,
                                calibration_state: dict | None = None,
                                ticker_studies: dict | None = None,
                                financial_df=None) -> dict:
    """Delegate to ``prediction.pipeline.compute_price_predictions`` (Phase B)."""
    from prediction.pipeline import compute_price_predictions
    return compute_price_predictions(
        sim_rows,
        calibration_state=calibration_state,
        ticker_studies=ticker_studies,
        financial_df=financial_df,
    )


'''

new_lines = (
    lines[:SEQ_START]
    + [seq_wrappers]
    + lines[SEQ_END:COMPUTE_START]
    + [compute_wrapper]
    + lines[COMPUTE_END:]
)

ORCH.write_text("".join(new_lines), encoding="utf-8")
print(
    f"Patched orchestrator: removed {SEQ_END - SEQ_START} + {COMPUTE_END - COMPUTE_START} lines, "
    f"new total {len(new_lines)} lines"
)
