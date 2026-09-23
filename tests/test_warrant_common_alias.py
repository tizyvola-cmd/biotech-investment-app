"""Warrant → common alias for dead thin quotes (JSPRW → JSPR)."""
from __future__ import annotations

from refresh_live_signals import apply_metrics_to_snapshot, warrant_common_ticker


def test_warrant_common_ticker_strips_w():
    assert warrant_common_ticker("JSPRW") == "JSPR"
    assert warrant_common_ticker("NRXPW") == "NRXP"
    assert warrant_common_ticker("JSPR") is None
    assert warrant_common_ticker("WW") is None
    assert warrant_common_ticker("") is None


def test_apply_metrics_alias_writes_var_not_common_price():
    snap = {
        "columns": [
            "Ticker",
            "Prezzo Corrente ($)",
            "Var. Giorn. %",
            "Prezzo Apertura ($)",
        ],
        "rows": [
            {
                "Ticker": "JSPRW",
                "Prezzo Corrente ($)": 0.05,
                "Var. Giorn. %": None,
                "Prezzo Apertura ($)": 0.05,
            }
        ],
    }
    metrics = {
        "JSPRW": {
            "slope≈5g": 0.1,
            "slope≈20g": 0.2,
            "slope≈45g": 0.3,
            "run_up_30d": 5.0,
            "rsi_14": 50.0,
            "vol_ratio": 1.0,
            "affid_live": 70,
            "affid_live_pct": 0.7,
            "pred5_live": 2.0,
            "direction_live": "down",
            "updated_at": "2026-07-24",
            "current_price": 12.0,  # common absolute — must NOT overwrite warrant mark
            "prev_close": 12.4,
            "session_open": 12.1,
            "adv_shares_20d": 200_000,
            "low_liq_noise": False,
            "low_liq_reason": None,
        }
    }
    out = apply_metrics_to_snapshot(
        snap,
        metrics,
        quote_alias_of={"JSPRW": "JSPR"},
        update_prices=True,
    )
    row = out["rows"][0]
    assert row["live_quote_ticker"] == "JSPR"
    assert row["quote_is_alias"] is True
    assert row["Prezzo Corrente ($)"] == 0.05  # warrant mark preserved
    assert row["Var. Giorn. %"] == round((12.0 - 12.4) / 12.4 * 100, 2)
    assert row["direction_live"] == "down"
