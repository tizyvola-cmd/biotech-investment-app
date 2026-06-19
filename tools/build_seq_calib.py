"""Build prediction/seq_calib.py from orchestrator excerpt."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
chunk = (ROOT / "tools" / "_seq_chunk.txt").read_text(encoding="utf-8")

body = chunk
body = body.replace("def _pred_curve_", "def pred_curve_")
body = body.replace("_pred_curve_close_cal", "pred_curve_close_cal")
body = body.replace("_pred_curve_trade_date_at_offset", "pred_curve_trade_date_at_offset")
body = body.replace("_pred_curve_series_upto_trade_date", "pred_curve_series_upto_trade_date")
body = body.replace("_pred_curve_knot_metrics_asof", "pred_curve_knot_metrics_asof")

body = body.replace(
    "def pred_curve_seq_apply_to_predictions(\n    result: dict,",
    "def pred_curve_seq_apply_to_predictions(\n    result: dict,",
)

body = body.replace(
    "    financial_df=None,\n) -> None:",
    "    financial_df=None,\n    offsets: tuple[int, ...] | None = None,\n) -> None:",
    1,
)

body = body.replace(
    "    if not result or not closes_long:\n        return\n    from datetime import date as _date, timedelta as _td\n",
    "    if not result or not closes_long:\n        return\n    import data_orchestrator as orch\n    from datetime import date as _date, timedelta as _td\n",
    1,
)

body = body.replace(
    "    offsets = SIMULATION_PRED_CAL_OFFSETS\n",
    "    if offsets is None:\n        offsets = getattr(\n            orch, 'SIMULATION_PRED_CAL_OFFSETS', DEFAULT_CAL_OFFSETS\n        )\n",
    1,
)

for name in (
    "nearest_hist_trade_date_to_calendar",
    "histlib_close_on_trade_date",
    "accuracy_sim_impute_missing_pre_cd_model_pcts",
    "accuracy_sim_synthesize_interp_nodes_from_post_d_only",
    "interp_pred_pct_vs_m60_calendar",
    "build_ticker_cik_map",
    "financial_series_for_ticker",
    "accuracy_cik_str_from_financial_row",
    "sec_cik_pad_10",
    "fetch_sec_company_submissions_json",
    "pred_curve_seq_merge_k8_observations_into_act",
):
    body = re.sub(rf"(?<![.\w])_{name}\(", rf"orch._{name}(", body)

body = body.replace("_pred_curve_seq_load()", "pred_curve_seq_load()")
body = body.replace("_pred_curve_seq_save(", "pred_curve_seq_save(")
body = body.replace("_pred_curve_k8_seq_merge_enabled()", "pred_curve_k8_seq_merge_enabled()")
body = body.replace("_CURVE_SEQ_STATE_PATH", "CURVE_SEQ_STATE_PATH")

# knot helpers: hist deps via orch in close_cal / trade_date
body = body.replace(
    "def pred_curve_close_cal(close_series, cd, cal_off: int):\n    \"\"\"Close reale",
    "def pred_curve_close_cal(close_series, cd, cal_off: int):\n    import data_orchestrator as orch\n    \"\"\"Close reale",
    1,
)
body = body.replace(
    "def pred_curve_trade_date_at_offset(close_series, cd, cal_off: int):\n    \"\"\"Data di negoziazione",
    "def pred_curve_trade_date_at_offset(close_series, cd, cal_off: int):\n    import data_orchestrator as orch\n    \"\"\"Data di negoziazione",
    1,
)

header = '''"""
Sequential curve calibration state, knot metrics, and in-place prediction updates.
"""
from __future__ import annotations

import os

from prediction.config import (
    CURVE_SEQ_STATE_PATH,
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_env_enabled,
    pred_curve_seq_load,
    pred_curve_seq_save,
    pred_curve_seq_snap_cal_day_to_offset_index,
)

DEFAULT_CAL_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)


'''

footer = '''

__all__ = [
    "DEFAULT_CAL_OFFSETS",
    "pred_curve_close_cal",
    "pred_curve_k8_seq_merge_enabled",
    "pred_curve_knot_metrics_asof",
    "pred_curve_seq_apply_to_predictions",
    "pred_curve_seq_env_enabled",
    "pred_curve_seq_load",
    "pred_curve_seq_save",
    "pred_curve_seq_snap_cal_day_to_offset_index",
    "pred_curve_series_upto_trade_date",
    "pred_curve_trade_date_at_offset",
]
'''

(ROOT / "prediction" / "seq_calib.py").write_text(header + body + footer, encoding="utf-8")
print("Wrote prediction/seq_calib.py", len(header + body + footer))
