"""One-off Phase B extract helper (run from repo root)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORCH = ROOT / "data_orchestrator.py"
lines = ORCH.read_text(encoding="utf-8").splitlines(keepends=True)

# seq_calib block: knot helpers 8899-9077, apply 9080-9312 (1-based -> 0-based)
SEQ_KNOT_START, SEQ_KNOT_END = 8898, 9077
SEQ_APPLY_START, SEQ_APPLY_END = 9079, 9312

# compute_price_predictions 11508-12812
COMPUTE_START, COMPUTE_END = 11507, 12812


def extract_seq_calib() -> str:
    knot = "".join(lines[SEQ_KNOT_START:SEQ_KNOT_END])
    apply = "".join(lines[SEQ_APPLY_START:SEQ_APPLY_END])
    knot = knot.replace("def _pred_curve_", "def pred_curve_")
    apply = apply.replace(
        "def _pred_curve_seq_apply_to_predictions(",
        "def pred_curve_seq_apply_to_predictions(",
        1,
    )
    apply = apply.replace("_pred_curve_", "pred_curve_")
    apply = apply.replace("_pred_curve_seq_", "pred_curve_seq_")
    apply = apply.replace("_pred_curve_k8_seq_merge_enabled()", "pred_curve_k8_seq_merge_enabled()")
    apply = apply.replace("_pred_curve_seq_load()", "pred_curve_seq_load()")
    apply = apply.replace("_pred_curve_seq_save(", "pred_curve_seq_save(")
    apply = apply.replace("SIMULATION_PRED_CAL_OFFSETS", "offsets")
    apply = apply.replace(
        "offsets = offsets",
        "# offsets injected via parameter",
    )
    # fix the offsets line
    apply = apply.replace("    offsets = offsets\n", "")

    header = '''"""
Sequential curve calibration: knot metrics and in-place prediction updates.
"""
from __future__ import annotations

import os
from typing import Any, Callable

from prediction.config import (
    CURVE_SEQ_STATE_PATH,
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_load,
    pred_curve_seq_save,
)

# Default calendar offsets (mirror data_orchestrator.SIMULATION_PRED_CAL_OFFSETS)
DEFAULT_CAL_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 4, 7)


def _orch():
    import data_orchestrator as orch
    return orch


'''
    knot = knot.replace("def pred_curve_close_cal", "def pred_curve_close_cal")
    for fn in (
        "nearest_hist_trade_date_to_calendar",
        "histlib_close_on_trade_date",
    ):
        knot = re.sub(
            rf"(?<![.\w])_{fn}\(",
            rf"orch._{fn}(",
            knot,
        )
    knot = knot.replace(
        "def pred_curve_close_cal(close_series, cd, cal_off: int):",
        "def pred_curve_close_cal(close_series, cd, cal_off: int, *, orch=None):",
        1,
    )
    if "orch = _orch()" not in knot:
        knot = knot.replace(
            '    """Close reale vicina',
            "    if orch is None:\n        orch = _orch()\n    \"\"\"Close reale vicina",
            1,
        )

    apply = re.sub(
        r"def pred_curve_seq_apply_to_predictions\(\n    result: dict,",
        "def pred_curve_seq_apply_to_predictions(\n    result: dict,",
        apply,
        count=1,
    )
    # Add parameters after financial_df
    apply = apply.replace(
        "    financial_df=None,\n) -> None:",
        "    financial_df=None,\n    offsets: tuple[int, ...] | None = None,\n    *,\n    orch=None,\n) -> None:",
        1,
    )
    apply = apply.replace(
        "    if not result or not closes_long:\n        return\n",
        "    if not result or not closes_long:\n        return\n    if orch is None:\n        orch = _orch()\n    if offsets is None:\n        offsets = getattr(orch, 'SIMULATION_PRED_CAL_OFFSETS', DEFAULT_CAL_OFFSETS)\n",
        1,
    )

    orch_calls = [
        "accuracy_sim_impute_missing_pre_cd_model_pcts",
        "accuracy_sim_synthesize_interp_nodes_from_post_d_only",
        "interp_pred_pct_vs_m60_calendar",
        "build_ticker_cik_map",
        "financial_series_for_ticker",
        "accuracy_cik_str_from_financial_row",
        "sec_cik_pad_10",
        "fetch_sec_company_submissions_json",
        "pred_curve_seq_merge_k8_observations_into_act",
    ]
    for name in orch_calls:
        apply = re.sub(
            rf"(?<![.\w])_{name}\(",
            rf"orch._{name}(",
            apply,
        )
    apply = apply.replace("_CURVE_SEQ_STATE_PATH", "CURVE_SEQ_STATE_PATH")

    return header + knot + "\n\n" + apply


def extract_market_data() -> str:
    opt_lines = lines[11710:11748]  # def _options_signals ... return {}
    close_lines = lines[11886:11926]  # def _close_series_from_raw ... return out

    opt = "".join(opt_lines).replace("    def _options_signals", "def options_signals", 1)
    opt = re.sub(r"\n    ", "\n", opt)
    close = "".join(close_lines).replace(
        "    def _close_series_from_raw", "def close_series_from_raw", 1
    )
    close = re.sub(r"\n    ", "\n", close)
    close = close.replace("_strip_to_1d_float_series", "_strip_to_1d_float_series")
    close = close.replace(
        "out = _strip_to_1d_float_series(cand)",
        "    import data_orchestrator as orch\n    out = orch._strip_to_1d_float_series(cand)",
    )
    close = close.replace(
        "return _index_to_dates(out)",
        "return orch._index_to_dates(out)",
    )

    return f'''"""
Market data helpers for prediction (yfinance / Yahoo raw frames).
"""
from __future__ import annotations

import pandas as pd


{opt}

{close}


__all__ = ["options_signals", "close_series_from_raw"]
'''


def extract_pipeline() -> str:
    block = "".join(lines[COMPUTE_START:COMPUTE_END])
    src = block.replace("def _compute_price_predictions(", "def compute_price_predictions(", 1)

    prediction_aliases = {
        "_calib_load": "calib_load",
        "_calib_bias": "calib_bias",
        "_fit_precat_from_pairs": "fit_precat_from_pairs",
        "_direction_ensemble": "direction_ensemble",
        "_pred_curve_seq_env_enabled": "pred_curve_seq_env_enabled",
        "_pred_curve_seq_apply_to_predictions": "pred_curve_seq_apply_to_predictions",
    }
    for old, new in prediction_aliases.items():
        src = src.replace(old, new)

    src = re.sub(
        r"\n    def _options_signals\([^)]*\)[\s\S]*?except Exception:\n            return \{\}\n",
        "\n",
        src,
        count=1,
    )
    src = re.sub(
        r"\n    def _close_series_from_raw\([^)]*\)[\s\S]*?except Exception:\n            return None\n",
        "\n",
        src,
        count=1,
    )

    orch_text = ORCH.read_text(encoding="utf-8")
    orch_defs = set(re.findall(r"^def (_[a-zA-Z0-9_]+)", orch_text, re.M))

    call_pat = re.compile(r"(?<![.\w])_([a-z][a-z0-9_]*)\(")
    calls = set(call_pat.findall(src))
    skip = {"options_signals", "close_series_from_raw"}
    for name in sorted(calls, key=len, reverse=True):
        if name in skip:
            continue
        sym = f"_{name}"
        if sym in prediction_aliases:
            continue
        if sym in orch_defs:
            src = re.sub(rf"(?<![.\w])_{name}\(", f"orch._{name}(", src)

    src = src.replace("orch.orch.", "orch.")

    header = '''"""
Catalyst price prediction pipeline (Phase B canonical implementation).
"""
from __future__ import annotations

from prediction.calibration import calib_bias, calib_load
from prediction.config import pred_curve_seq_env_enabled
from prediction.curve_fit import fit_precat_from_pairs
from prediction.direction_ensemble import direction_ensemble
from prediction.market_data import close_series_from_raw, options_signals
from prediction.seq_calib import pred_curve_seq_apply_to_predictions
from prediction.types import PredictionRunConfig


def _orch():
    import data_orchestrator as orch
    return orch


def predict_catalyst(
    sim_rows: list,
    *,
    config: PredictionRunConfig | None = None,
    ticker_studies: dict | None = None,
) -> dict:
    cfg = config or PredictionRunConfig()
    return compute_price_predictions(
        sim_rows,
        calibration_state=cfg.calibration_state,
        ticker_studies=ticker_studies,
        financial_df=cfg.financial_df,
    )


'''
    idx = src.find('"""')
    idx2 = src.find('"""', idx + 3)
    insert_at = idx2 + 3
    while insert_at < len(src) and src[insert_at] in "\r\n":
        insert_at += 1
    src = src[:insert_at] + "\n    orch = _orch()\n    _options_signals = options_signals\n    _close_series_from_raw = close_series_from_raw\n" + src[insert_at:]

    return header + src


if __name__ == "__main__":
    (ROOT / "prediction" / "pipeline.py").write_text(extract_pipeline(), encoding="utf-8")
    print("Wrote prediction/pipeline.py")
