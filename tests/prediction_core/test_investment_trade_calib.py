"""Tests per investment_trade_calib (Fase B)."""
from prediction.investment_trade_calib import (
    DEFAULTS,
    compute_trade_calibration,
    get_threshold,
)


def _pos(
    *,
    entry_s20: float,
    pnl_pct: float,
    win: bool = True,
    exit_s20: float | None = None,
    aff: float = 65.0,
) -> dict:
    return {
        "entry_slope_20d": entry_s20,
        "pnl_pct": pnl_pct,
        "pnl_eur": 100.0 if win else -50.0,
        "is_win": win,
        "entry_affidabilita_pct": aff,
        "entry_r2_fit": 0.45,
        "entry_pred5_pp": 2.0,
        "days_to_cd": 20,
        "exit_slope_20d": exit_s20,
    }


def test_compute_defaults_with_no_positions():
    out = compute_trade_calibration([])
    assert out["n_positions"] == 0
    assert out["thresholds"]["buy_slope20d_min_pp_per_day"]["value"] == DEFAULTS[
        "buy_slope20d_min_pp_per_day"
    ]


def test_buy_threshold_picks_stricter_when_high_slope_wins():
    rows = [
        _pos(entry_s20=0.15, pnl_pct=5.0, win=True),
        _pos(entry_s20=0.18, pnl_pct=8.0, win=True),
        _pos(entry_s20=0.12, pnl_pct=6.0, win=True),
        _pos(entry_s20=0.14, pnl_pct=4.0, win=True),
        _pos(entry_s20=0.16, pnl_pct=7.0, win=True),
        _pos(entry_s20=0.11, pnl_pct=3.0, win=True),
        _pos(entry_s20=0.05, pnl_pct=-4.0, win=False),
        _pos(entry_s20=0.04, pnl_pct=-3.0, win=False),
        _pos(entry_s20=0.06, pnl_pct=-2.0, win=False),
        _pos(entry_s20=0.03, pnl_pct=-5.0, win=False),
        _pos(entry_s20=0.02, pnl_pct=-1.0, win=False),
    ]
    out = compute_trade_calibration(rows)
    buy = out["thresholds"]["buy_slope20d_min_pp_per_day"]
    assert buy["value"] >= 0.075
    assert buy.get("reliable") is True
    assert buy.get("n", 0) >= 5
    assert (buy.get("win_rate_pct") or 0) >= 80


def test_get_threshold_from_payload():
    payload = compute_trade_calibration([_pos(entry_s20=0.2, pnl_pct=3.0)])
    assert get_threshold("buy_slope20d_min_pp_per_day", payload) >= 0.05
