"""Tests for prediction.market_context_gate regime rules."""
from __future__ import annotations

import pytest

from prediction.market_context_gate import (
    THRESHOLDS,
    apply_regime_to_precat_kind,
    build_gate_payload,
    classify_regime,
    compute_regime_signals,
)


def _signals(**kw):
    base = {
        "xbi_5d_return": 0.0,
        "xbi_20d_return": 0.0,
        "tlt_5d_return": 0.0,
        "vix_level": 20.0,
        "data_ok": True,
    }
    base.update(kw)
    return base


def test_classify_crisis_vix():
    assert classify_regime(_signals(vix_level=36)) == "CRISIS"


def test_classify_crisis_xbi_5d():
    assert classify_regime(_signals(xbi_5d_return=-9)) == "CRISIS"


def test_classify_risk_off_xbi_5d():
    assert classify_regime(_signals(xbi_5d_return=-4)) == "RISK_OFF"


def test_classify_risk_off_rates():
    assert classify_regime(_signals(xbi_5d_return=0, xbi_20d_return=-7, tlt_5d_return=1.5)) == "RISK_OFF"


def test_classify_risk_on():
    assert classify_regime(_signals(xbi_5d_return=3, xbi_20d_return=4)) == "RISK_ON"


def test_classify_neutral_default():
    assert classify_regime(_signals()) == "NEUTRAL"


def test_risk_off_gates_enter_to_hold():
    gated, fired, _ = apply_regime_to_precat_kind("enter", "RISK_OFF")
    assert gated == "hold"
    assert fired is True


def test_crisis_gates_enter_to_avoid():
    gated, fired, _ = apply_regime_to_precat_kind("enter", "CRISIS")
    assert gated == "avoid"
    assert fired is True


def test_risk_on_no_gate():
    gated, fired, _ = apply_regime_to_precat_kind("enter", "RISK_ON")
    assert gated == "enter"
    assert fired is False


def test_build_gate_payload_shape():
    payload = build_gate_payload("enter", "RISK_OFF", _signals(xbi_5d_return=-4.2))
    assert payload["market_regime"] == "RISK_OFF"
    assert payload["original_signal"] == "enter"
    assert payload["gated_signal"] == "hold"
    assert payload["regime_gate_fired"] is True
    assert "XBI" in payload["gate_reason"]


def test_compute_regime_signals_mock():
    xbi = [100.0] * 21 + [96.0]  # ~-4% over 5d
    tlt = [90.0] * 26
    sig = compute_regime_signals(xbi_closes=xbi, tlt_closes=tlt, vix_level=22)
    assert sig["xbi_5d_return"] is not None
    assert sig["data_ok"] is True
