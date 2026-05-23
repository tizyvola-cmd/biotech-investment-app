"""v5 q50 for MAE must match Accuracy Pred % column when anchor is on."""
from __future__ import annotations

import os

from prediction.config import reset_config
from prediction.pipeline import sync_v5_q50_to_accuracy_display_pred


def test_sync_v5_to_display_pred_pts():
    display = [0.0, 1.5, -2.0, 3.0, -1.0, 0.5, 4.0, 2.0]
    v5 = {str(o): 99.0 for o in (-60, -30, -10, -7, -5, -3, 4, 7)}
    os.environ["PRED_V5_ANCHOR_Q50_V4"] = "1"
    reset_config()
    try:
        out = sync_v5_q50_to_accuracy_display_pred(v5, display)
        assert out["-30"] == 1.5
        assert out["-7"] == 3.0
        assert out["4"] == 4.0
    finally:
        os.environ.pop("PRED_V5_ANCHOR_Q50_V4", None)
        reset_config()
