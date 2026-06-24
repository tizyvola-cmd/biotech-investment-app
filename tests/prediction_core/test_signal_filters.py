"""Tests for rotation veto and UP confidence gate."""
from prediction.signal_filters import (
    apply_rotation_veto,
    apply_up_confidence_gate,
    is_slope_rotation,
    up_confidence_gate_passes,
)


def test_rotation_detected():
    assert is_slope_rotation(1.2, -0.8) is True
    assert is_slope_rotation(0.05, 0.8) is False
    assert is_slope_rotation(0.5, 0.4) is False


def test_rotation_veto_up_only():
    assert apply_rotation_veto("↑ Moderato", 1.2, -0.8) == "→ Stabile"
    assert apply_rotation_veto("↓ Moderato", 1.2, -0.8) == "↓ Moderato"
    assert apply_rotation_veto("↑ Moderato", 0.5, 0.4) == "↑ Moderato"


def test_up_gate_blocks_weak():
    ok, reasons = up_confidence_gate_passes(
        slope_5d=0.3,
        slope_20d=-0.2,
        vol_ratio=1.0,
        rsi_14=70,
        days_to_cd=20,
    )
    assert ok is False
    assert len(reasons) >= 2


def test_up_gate_passes():
    ok, _ = up_confidence_gate_passes(
        slope_5d=0.8,
        slope_20d=0.4,
        vol_ratio=1.5,
        rsi_14=55,
        days_to_cd=25,
    )
    assert ok is True
    assert apply_up_confidence_gate("↑ Forte", slope_5d=0.8, slope_20d=0.4, vol_ratio=1.5, rsi_14=55, days_to_cd=25) == "↑ Forte"
