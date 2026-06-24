"""
Modular prediction core (Phase A).

Public helpers re-exported for scripts and gradual migration off data_orchestrator.
"""
from prediction.calibration import calib_bias, calib_load, calib_save, direction_calib_multiplier
from prediction.config import (
    CALIB_PATH,
    CALIB_STATE_PATH,
    CURVE_SEQ_STATE_PATH,
    PredictionConfig,
    get_config,
    pred_curve_seq_env_enabled,
    print_config_table,
    reset_config,
)
from prediction.curve_fit import fit_precat_from_pairs, predict_at, r2
from prediction.direction_ensemble import (
    direction_ensemble,
    direction_ensemble_detail,
    invalidate_s5d_weight_cache,
)
from prediction.slope_contrarian_calib import run_contrarian_calibration
from prediction.seq_calib import (
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_load,
    pred_curve_seq_save,
)
from prediction.types import (
    DirectionResult,
    PredictionConfig as PredictionRunConfig,
    PrecatFitResult,
)

__all__ = [
    "CALIB_PATH",
    "CALIB_STATE_PATH",
    "CURVE_SEQ_STATE_PATH",
    "DirectionResult",
    "PredictionConfig",
    "PredictionRunConfig",
    "get_config",
    "print_config_table",
    "reset_config",
    "PrecatFitResult",
    "calib_bias",
    "calib_load",
    "calib_save",
    "direction_calib_multiplier",
    "direction_ensemble",
    "direction_ensemble_detail",
    "invalidate_s5d_weight_cache",
    "run_contrarian_calibration",
    "fit_precat_from_pairs",
    "predict_at",
    "pred_curve_k8_seq_merge_enabled",
    "pred_curve_seq_env_enabled",
    "pred_curve_seq_load",
    "pred_curve_seq_save",
    "r2",
]
