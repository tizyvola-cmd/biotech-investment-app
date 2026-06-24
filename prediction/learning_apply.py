"""
Apply cluster cal_factor + regime multiplier before global cal_factor v4.

Order in prediction magnitude chain:
  base fit → seq recalib → EIS → **cluster CF** → **regime ×** → global CF → daily open
"""
from __future__ import annotations

import os
from typing import Any, Mapping

from prediction.cluster_cal_factor import apply_cluster_cal_factor, ticker_metadata_from_row
from prediction.regime_calibration import apply_regime_multiplier, get_current_regime


def learning_magnitude_enabled() -> bool:
    return os.environ.get("PRED_LEARNING_MAGNITUDE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def apply_magnitude_learning(
    pred_pct: float,
    row: Mapping[str, Any] | None = None,
    *,
    ticker_data: dict[str, Any] | None = None,
    regime: str | None = None,
) -> float:
    """Cluster CF (60/40 blend) then regime multiplier."""
    if not learning_magnitude_enabled():
        return pred_pct
    if pred_pct != pred_pct:
        return pred_pct
    td = ticker_data or ticker_metadata_from_row(dict(row) if row else None)
    x = apply_cluster_cal_factor(pred_pct, td)
    x = apply_regime_multiplier(x, regime)  # type: ignore[arg-type]
    return x


def scale_pct_sequence_with_learning(
    pts: list[float | None],
    row: Mapping[str, Any] | None,
) -> list[float | None]:
    out: list[float | None] = []
    for p in pts:
        if p is None or p != p:
            out.append(p)
            continue
        out.append(apply_magnitude_learning(float(p), row))
    return out
