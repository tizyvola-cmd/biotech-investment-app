"""Daily-recalib lift must compare daily vs base on the SAME daily subset.

Regression guard for the apples-to-oranges bug where the full-set base mean
(over all events, incl. old high-error events without a daily path) was
subtracted from the daily mean (over the daily subset only), inflating the lift.
"""
from __future__ import annotations

from prediction.pre_cd_curve_impact import _accumulate_series


def test_matched_base_uses_same_daily_subset():
    events = [
        # Old event WITHOUT a daily path and a huge base error -> inflates the
        # full-set base mean but must NOT affect the matched (subset) base.
        {"day": "2026-04-29", "ticker": "AAA", "path_rmse_base": 22.0, "hit_base": False},
        {
            "day": "2026-06-17", "ticker": "BBB",
            "path_rmse_base": 8.0, "path_rmse_daily": 7.0,
            "has_daily_path": True, "hit_base": True, "hit_daily": True,
        },
        {
            "day": "2026-06-18", "ticker": "CCC",
            "path_rmse_base": 6.0, "path_rmse_daily": 5.0,
            "has_daily_path": True, "hit_base": False, "hit_daily": True,
        },
    ]
    last = _accumulate_series(events)[-1]

    # full-set base mean = (22+8+6)/3 = 12.0 (inflated by the no-daily event)
    assert last["cum_mae_base"] == 12.0
    # daily mean over the subset = (7+5)/2 = 6.0
    assert last["cum_mae_daily"] == 6.0
    # MATCHED base over the SAME daily subset = (8+6)/2 = 7.0
    assert last["cum_mae_base_on_daily"] == 7.0
    assert last["n_with_daily"] == 2

    # Honest lift = daily - matched base = -1.0 (not the inflated -6.0).
    honest = last["cum_mae_daily"] - last["cum_mae_base_on_daily"]
    inflated = last["cum_mae_daily"] - last["cum_mae_base"]
    assert honest == -1.0
    assert inflated == -6.0
    assert honest > inflated  # matched comparison is less rosy

    # Matched base hit-rate over the subset = 1/2 = 50% (not 1/3 of full set).
    assert last["cum_hit_base_on_daily_pct"] == 50.0
