"""
Precatalyst price curve fitting (linear / quadratic / exponential).
"""
from __future__ import annotations

from typing import Any

import numpy as np

from prediction.types import PrecatFitResult


def r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0


def predict_at(x_t: float, coeffs: Any, fit_type: str) -> float:
    if fit_type == "exp":
        return float(np.exp(np.polyval(coeffs, float(x_t))) - 105.0)
    return float(np.polyval(coeffs, float(x_t)))


def fit_precat_from_pairs(
    pairs: list[tuple[float, float]],
    days_to_t: int,
    *,
    ticker: str | None = None,
    log_short_fit: bool = True,
) -> PrecatFitResult | None:
    """
    Fit precatalyst % vs calendar-day offset and extrapolate model_dm* / d* horizons.

    ``pairs``: (dx_calendar, pct_vs_p_now) with dx in [-130, 0].
    ``days_to_t``: calendar days from today to completion (CD).
    """
    if len(pairs) < 3:
        return None

    pairs = sorted(pairs)
    x_arr = np.array([p[0] for p in pairs])
    y_arr = np.array([p[1] for p in pairs])

    if len(pairs) < 5 and log_short_fit and ticker:
        print(
            f"[Pred] {ticker} — fit precatalizzatore ridotto "
            f"({len(pairs)} punti in [−130,0] gg vs oggi; ≥5 per poli/exp. completi).",
            flush=True,
        )

    candidates: dict = {}
    try:
        c = np.polyfit(x_arr, y_arr, 1)
        candidates["Lineare"] = (r2(y_arr, np.polyval(c, x_arr)), c, "lin")
    except Exception as e:
        print(f"[Pred] Fit lineare fallback fallito: {e}")
    if len(pairs) >= 6:
        try:
            c = np.polyfit(x_arr, y_arr, 2)
            candidates["Polin°2"] = (r2(y_arr, np.polyval(c, x_arr)), c, "pol")
        except Exception as e:
            print(f"[Pred] Fit polinomiale fallback fallito: {e}")
    if len(pairs) >= 5:
        try:
            y_sh = y_arr + 105.0
            if np.all(y_sh > 0):
                c = np.polyfit(x_arr, np.log(y_sh), 1)
                y_pred_e = np.exp(np.polyval(c, x_arr)) - 105.0
                candidates["Esponenziale"] = (r2(y_arr, y_pred_e), c, "exp")
        except Exception as e:
            print(f"[Pred] Fit esponenziale fallback fallito: {e}")

    if not candidates:
        return None

    best_name = max(candidates, key=lambda k: candidates[k][0])
    best_r2, best_c, best_type = candidates[best_name]
    delta = int(days_to_t)

    def _at(x_t: float) -> float:
        return predict_at(x_t, best_c, best_type)

    return PrecatFitResult(
        best_name=best_name,
        best_r2=float(best_r2),
        best_type=best_type,
        best_coeffs=best_c,
        model_dm7_pct=round(_at(delta - 7), 1),
        model_dm5_pct=round(_at(delta - 5), 1),
        model_dm3_pct=round(_at(delta - 3), 1),
        model_dm10_pct=round(_at(delta - 10), 1),
        model_dm30_pct=round(_at(delta - 30), 1),
        model_dm60_pct=round(_at(delta - 60), 1),
        d3_pct=round(_at(delta + 3), 1),
        d5_pct=round(_at(delta + 5), 1),
        d10_pct=round(_at(delta + 10), 1),
        d30_pct=round(_at(delta + 30), 1),
        model_d4_pct=round(_at(delta + 4), 1),
        model_d7_pct=round(_at(delta + 7), 1),
    )
