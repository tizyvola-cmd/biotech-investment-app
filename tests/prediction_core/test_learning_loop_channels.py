"""Tests for the 3-channel learning-loop impact module."""
from __future__ import annotations

import prediction.learning_loop_channels as llc
import prediction.sign_curve_daily as scd


def _outcome(pred: float, actual: float, date: str) -> dict:
    return {"pred": pred, "actual": actual, "date": date}


def _sign_curve(
    *,
    sim_sign: float | None = 59.3,
    weekly: list[dict] | None = None,
) -> dict:
    return {
        "cohorts": {
            "simulation": {
                "n_events": 40,
                "n_sessions_pre_cd": 500,
                "overall_sign_hit_pre_cd_pct": sim_sign,
                "overall_price_accuracy_pre_cd_pct": 88.0,
                "weekly_pre_cd": weekly if weekly is not None else [
                    {"week": "2026-W22", "n": 30, "sign_hit_pct": 55.0, "price_accuracy_pct": 86.0},
                    {"week": "2026-W23", "n": 30, "sign_hit_pct": 60.0, "price_accuracy_pct": 88.0},
                ],
            },
            "retro": {
                "overall_sign_hit_pre_cd_pct": 65.5,
                "overall_price_accuracy_pre_cd_pct": 90.0,
            },
        },
    }


def _pos(sds: float | None, pnl_pct: float, *, regime: str = "RISK_ON", date: str = "2026-06-10") -> dict:
    return {
        "entry_sds_score": sds,
        "entry_regime": regime,
        "pnl_pct": pnl_pct,
        "pnl_eur": pnl_pct * 100.0,
        "is_win": pnl_pct > 0,
        "entry_date": date,
    }


def test_prediction_channel_pre_cd_and_weekly(monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [_outcome(5.0, 4.0, "2026-06-01")])
    monkeypatch.setattr(llc, "_load_positions", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", _sign_curve)
    pred = llc.compute_channel_impact()["prediction"]
    assert pred["available"] is True
    # headline is the pre-CD sign-hit of the Simulation cohort, with retro benchmark
    assert pred["pre_cd_sign_hit_pct"] == 59.3
    assert pred["pre_cd_price_accuracy_pct"] == 88.0
    assert pred["benchmark_sign_hit_pct"] == 65.5
    # week-over-week: 60.0 - 55.0 = +5.0pp, both weeks above the min-sample guard
    assert pred["weekly_delta_pp"] == 5.0
    assert pred["weekly_significant"] is True
    # loops list still carries the regime + daily-curve descriptors
    loop_ids = {lp["loop"] for lp in pred["loops"]}
    assert {"regime_multiplier", "daily_curve_recalib"} <= loop_ids


def test_prediction_channel_unavailable_without_sign_curve(monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_positions", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    pred = llc.compute_channel_impact()["prediction"]
    assert pred["available"] is False
    assert pred["pre_cd_sign_hit_pct"] is None
    assert pred["weekly"] == []
    assert pred["note"]


def test_prediction_weekly_improvement_guards_small_samples():
    # below the min-sample guard -> not enough trusted weeks -> not significant
    weekly = [
        {"week": "2026-W22", "n": 5, "sign_hit_pct": 50.0},
        {"week": "2026-W23", "n": 5, "sign_hit_pct": 70.0},
    ]
    delta, sig = llc._weekly_improvement(weekly)
    assert delta is None and sig is False
    # trusted weeks but move below threshold -> not significant
    weekly2 = [
        {"week": "2026-W22", "n": 40, "sign_hit_pct": 60.0},
        {"week": "2026-W23", "n": 40, "sign_hit_pct": 61.0},
    ]
    delta2, sig2 = llc._weekly_improvement(weekly2)
    assert delta2 == 1.0 and sig2 is False


def test_sign_curve_weekly_pre_cd_series_excludes_post_cd():
    sessions = [
        {"cal_offset": -10, "sign_hit": True, "price_accuracy_pct": 90.0, "date": "2026-06-01"},
        {"cal_offset": -5, "sign_hit": False, "price_accuracy_pct": 80.0, "date": "2026-06-02"},
        {"cal_offset": 3, "sign_hit": True, "price_accuracy_pct": 50.0, "date": "2026-06-03"},  # post-CD
    ]
    out = scd._weekly_pre_cd_series(sessions)
    assert len(out) == 1  # the three days fall in one ISO week
    wk = out[0]
    assert wk["n"] == 2  # post-CD session excluded
    assert wk["sign_hit_pct"] == 50.0
    assert wk["price_accuracy_pct"] == 85.0


def test_recommendation_channel_unavailable_without_sds(monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: [_pos(None, 5.0)])
    rec = llc.compute_channel_impact()["recommendation"]
    assert rec["available"] is False
    assert rec["actions"] == []


def test_recommendation_channel_buckets_by_sds(monkeypatch):
    positions = [
        _pos(80.0, 6.0),  # BUY_FULL win
        _pos(78.0, -2.0),  # BUY_FULL loss
        _pos(60.0, 3.0),  # BUY_HALF win
        _pos(40.0, -1.0),  # HOLD loss
    ]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    rec = llc.compute_channel_impact()["recommendation"]
    assert rec["available"] is True
    actions = {a["action"]: a for a in rec["actions"]}
    assert actions["BUY_FULL"]["n"] == 2
    assert actions["BUY_HALF"]["n"] == 1
    assert actions["HOLD"]["n"] == 1


def test_regime_gate_forces_hold(monkeypatch):
    positions = [_pos(90.0, 4.0, regime="CRISIS")]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    rec = llc.compute_channel_impact()["recommendation"]
    actions = {a["action"]: a for a in rec["actions"]}
    assert "HOLD" in actions and actions["HOLD"]["n"] == 1


def test_trading_channel_aggregates(monkeypatch):
    positions = [_pos(80.0, 10.0), _pos(80.0, -4.0)]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    trd = llc.compute_channel_impact()["trading"]
    assert trd["n"] == 2
    assert trd["win_pct"] == 50.0
    assert trd["mean_pnl_pct"] == 3.0


def test_trading_channel_regime_breakdown(monkeypatch):
    positions = [
        _pos(80.0, 10.0, regime="RISK_ON"),  # win
        _pos(80.0, 6.0, regime="RISK_ON"),  # win
        _pos(80.0, -4.0, regime="NEUTRAL"),  # loss
        _pos(80.0, 2.0, regime=""),  # unknown regime
    ]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    trd = llc.compute_channel_impact()["trading"]
    assert trd["regime_available"] is True
    assert trd["regime_n"] == 3  # the empty-regime row is excluded
    regimes = {r["regime"]: r for r in trd["regimes"]}
    assert regimes["RISK_ON"]["n"] == 2
    assert regimes["RISK_ON"]["win_pct"] == 100.0
    assert regimes["NEUTRAL"]["n"] == 1
    assert regimes["NEUTRAL"]["win_pct"] == 0.0
    assert "UNKNOWN" not in regimes  # unknown buckets are not surfaced
    # lift is vs the whole-book win-rate (3/4 = 75%)
    assert regimes["RISK_ON"]["lift_vs_book_pp"] == 25.0
    assert regimes["NEUTRAL"]["lift_vs_book_pp"] == -75.0


def test_trading_regime_label_normalizes_variants():
    assert llc._regime_label({"entry_regime": "risk-on"}) == "RISK_ON"
    assert llc._regime_label({"entry_regime": "Risk Off"}) == "RISK_OFF"
    assert llc._regime_label({"market_regime": "CRISIS_MODE"}) == "CRISIS"
    assert llc._regime_label({"entry_regime": ""}) == "UNKNOWN"
    assert llc._regime_label({}) == "UNKNOWN"


def test_trading_regime_unavailable_without_regime(monkeypatch):
    positions = [_pos(80.0, 5.0, regime=""), _pos(70.0, -1.0, regime="")]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", lambda: {})
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    trd = llc.compute_channel_impact()["trading"]
    assert trd["regime_available"] is False
    assert trd["regime_n"] == 0
    assert trd["regimes"] == []


def test_weekly_snapshot_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_sign_curve", _sign_curve)
    monkeypatch.setattr(llc, "_load_positions", lambda: [_pos(80.0, 5.0)])
    monkeypatch.setattr(llc, "LEARNING_LOOP_WEEKLY_IMPACT_JSON", tmp_path / "wk.json")
    doc = llc.persist_weekly_channel_snapshot()
    assert len(doc["weeks"]) == 1
    hist = llc.load_weekly_channel_history()
    assert len(hist) == 1
    assert "trading" in hist[0] and "week" in hist[0]
