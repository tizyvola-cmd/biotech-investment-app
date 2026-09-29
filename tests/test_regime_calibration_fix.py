"""Tests for the RISK_ON regime-multiplier fix.

Covers the three root causes:
  * the date funnel (current regime stamped onto historical outcomes),
  * the dimensionally-incoherent ``1 - bias/12`` formula, and
  * the absence of a self-validation guard.
"""
from __future__ import annotations

from prediction import regime_calibration as rc


def test_get_regime_at_date_does_not_funnel(monkeypatch):
    """Past dates must not inherit the *current* regime."""
    monkeypatch.setattr(rc, "load_regime_history", lambda: {})
    monkeypatch.setattr(rc, "get_current_regime", lambda: "RISK_ON")

    # Unknown past date -> UNKNOWN (excluded), never the live regime.
    assert rc.get_regime_at_date("2026-01-01") == rc.UNKNOWN_REGIME
    # A recorded historical regime is honoured.
    monkeypatch.setattr(rc, "load_regime_history", lambda: {"2026-01-02": "RISK_OFF"})
    assert rc.get_regime_at_date("2026-01-02") == "RISK_OFF"
    # Today resolves to the live regime.
    assert rc.get_regime_at_date(rc._today_iso()) == "RISK_ON"


def test_enrich_tags_unknown_not_current(monkeypatch):
    monkeypatch.setattr(rc, "load_regime_history", lambda: {})
    monkeypatch.setattr(rc, "get_current_regime", lambda: "RISK_ON")
    tagged = rc.enrich_outcomes_with_regime([{"ticker": "AAA", "date": "2026-01-01", "pred": 3, "actual": 8}])
    assert tagged[0]["regime"] == rc.UNKNOWN_REGIME


def test_solver_holds_when_direction_unreliable():
    # Wrong sign on most pairs -> direction accuracy < 0.5 -> no magnitude scaling.
    pairs = [(3.0, -8.0)] * 7 + [(3.0, 8.0)] * 3
    mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
    dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)
    m, status = rc._solve_regime_multiplier(pairs, mae, dir_acc)
    assert status == "direction_unreliable"
    assert m == 1.0


def test_solver_scales_and_reduces_error_on_healthy_sample():
    # Correct sign, systematic under-magnitude (pred half of actual).
    pairs = [(4.0, 8.0), (5.0, 10.0), (3.0, 6.0), (6.0, 12.0), (2.0, 4.0),
             (4.5, 9.0), (3.5, 7.0), (5.5, 11.0)]
    mae = sum(abs(p - a) for p, a in pairs) / len(pairs)
    dir_acc = sum(1 for p, a in pairs if (p > 0) == (a > 0)) / len(pairs)
    m, status = rc._solve_regime_multiplier(pairs, mae, dir_acc)
    assert status == "active"
    assert m > 1.0  # scales magnitude up toward the actuals
    assert rc._pairs_mae(pairs, m) < mae  # genuinely reduces error


def test_solver_no_improvement_when_already_calibrated():
    pairs = [(5.0, 5.0)] * 8
    m, status = rc._solve_regime_multiplier(pairs, 0.0, 1.0)
    assert status == "no_improvement"
    assert m == 1.0


def test_compute_neutralizes_broken_risk_on_sample(monkeypatch, tmp_path):
    monkeypatch.setattr(rc, "REGIME_MULTIPLIERS_JSON", str(tmp_path / "rm.json"))
    monkeypatch.setattr(rc, "LEARNING_HISTORY_JSON", str(tmp_path / "lh.json"))
    monkeypatch.setattr(rc, "get_current_regime", lambda: "RISK_ON")
    # 33 RISK_ON outcomes, mostly wrong-signed (direction ~0.39).
    outcomes = [{"pred": 3.0, "actual": -8.0, "regime": "RISK_ON"} for _ in range(20)]
    outcomes += [{"pred": 3.0, "actual": 8.0, "regime": "RISK_ON"} for _ in range(13)]
    doc = rc.compute_regime_multipliers(outcomes, dry_run=True)
    risk_on = doc["regimes"]["RISK_ON"]
    assert risk_on["multiplier"] == 1.0
    assert risk_on["status"] == "direction_unreliable"


def test_compute_circuit_breaker_freezes_divergence(monkeypatch, tmp_path):
    import json

    # History: RISK_ON multiplier drifting up while regime layer worsens.
    weeks = {
        "weeks": [
            {"regime_multipliers": {"RISK_ON": 1.0}, "mae_after_regime": 7.1, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 1.1}, "mae_after_regime": 7.6, "mae_baseline": 7.2},
            {"regime_multipliers": {"RISK_ON": 1.2}, "mae_after_regime": 7.9, "mae_baseline": 7.2},
        ]
    }
    lh = tmp_path / "lh.json"
    lh.write_text(json.dumps(weeks), encoding="utf-8")
    monkeypatch.setattr(rc, "LEARNING_HISTORY_JSON", str(lh))
    cb = rc._circuit_breaker_for_regime("RISK_ON", 1.3)
    assert cb.triggered is True
    assert cb.value == 1.0
