"""Smoke tests for precatalyst curve fit."""
import numpy as np

from prediction.curve_fit import fit_precat_from_pairs, r2


def test_r2_perfect_line():
    y = np.array([1.0, 2.0, 3.0])
    assert abs(r2(y, y) - 1.0) < 1e-9


def test_fit_precat_returns_horizons():
    pairs = [(float(-30 + i), float(i) * 0.5) for i in range(20)]
    fit = fit_precat_from_pairs(pairs, days_to_t=14, ticker="TEST", log_short_fit=False)
    assert fit is not None
    assert fit.best_name in ("Lineare", "Polin°2", "Esponenziale")
    assert fit.model_dm3_pct is not None
    assert fit.d3_pct is not None
