"""Tests for the 3-channel learning-loop impact module."""
from __future__ import annotations

import prediction.learning_loop_channels as llc


def _outcome(pred: float, actual: float, date: str) -> dict:
    return {"pred": pred, "actual": actual, "date": date}


def _pos(sds: float | None, pnl_pct: float, *, regime: str = "RISK_ON", date: str = "2026-06-10") -> dict:
    return {
        "entry_sds_score": sds,
        "entry_regime": regime,
        "pnl_pct": pnl_pct,
        "pnl_eur": pnl_pct * 100.0,
        "is_win": pnl_pct > 0,
        "entry_date": date,
    }


def test_prediction_channel_direction_and_calibration(monkeypatch):
    outcomes = [
        _outcome(5.0, 4.0, "2026-06-01"),
        _outcome(-3.0, -2.0, "2026-06-02"),
        _outcome(2.0, -1.0, "2026-06-03"),  # wrong direction
    ]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: outcomes)
    monkeypatch.setattr(llc, "_load_positions", lambda: [])
    out = llc.compute_channel_impact()
    pred = out["prediction"]
    assert pred["n"] == 3
    # 2 of 3 have matching sign -> 66.7%
    assert pred["direction_hit_pct"] == 66.7
    assert pred["mae_pp"] is not None
    # loops list always carries the regime + daily-curve descriptors
    loop_ids = {lp["loop"] for lp in pred["loops"]}
    assert {"regime_multiplier", "daily_curve_recalib"} <= loop_ids


def test_recommendation_channel_unavailable_without_sds(monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
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
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    rec = llc.compute_channel_impact()["recommendation"]
    actions = {a["action"]: a for a in rec["actions"]}
    assert "HOLD" in actions and actions["HOLD"]["n"] == 1


def test_trading_channel_aggregates(monkeypatch):
    positions = [_pos(80.0, 10.0), _pos(80.0, -4.0)]
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_positions", lambda: positions)
    trd = llc.compute_channel_impact()["trading"]
    assert trd["n"] == 2
    assert trd["win_pct"] == 50.0
    assert trd["mean_pnl_pct"] == 3.0


def test_weekly_snapshot_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(llc, "_load_outcomes", lambda: [])
    monkeypatch.setattr(llc, "_load_positions", lambda: [_pos(80.0, 5.0)])
    monkeypatch.setattr(llc, "LEARNING_LOOP_WEEKLY_IMPACT_JSON", tmp_path / "wk.json")
    doc = llc.persist_weekly_channel_snapshot()
    assert len(doc["weeks"]) == 1
    hist = llc.load_weekly_channel_history()
    assert len(hist) == 1
    assert "trading" in hist[0] and "week" in hist[0]
