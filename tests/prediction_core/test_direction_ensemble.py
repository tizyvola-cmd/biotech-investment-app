"""Tests for direction_ensemble v4.1 (confidence, Phase 2, options)."""
from prediction.direction_ensemble import direction_ensemble, direction_ensemble_detail


def test_phase2_strong_bull_not_forced_neutral():
    """Fase 2: segnali bull forti possono dare ↑ (non più neutro forzato)."""
    detail = direction_ensemble_detail(
        2,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=50,
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=3,
        slope_5d=1.0,
        slope_20d=0.8,
    )
    assert detail.direction_label.startswith("↑")
    assert detail.phase == 2
    assert any("Ph2" in n for n in detail.notes)


def test_phase2_mixed_signals_often_stable():
    """Fase 2 con RSI OB + run-up: spesso neutro o debole."""
    direction, notes = direction_ensemble(
        2, 2.0, 2.0, 80, 2.5, 2.0, 25, 1.0, 1.0,
    )
    assert direction in ("→ Stabile", "↓ Calo lieve", "↓↓ Calo forte")
    assert any("Ph2" in n for n in notes)


def test_strong_bull_slope_and_volume():
    direction, notes = direction_ensemble(
        3,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=50,
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=3,
        slope_5d=1.0,
        slope_20d=0.8,
    )
    assert direction.startswith("↑")
    assert any("slope" in n.lower() for n in notes)


def test_strong_bear_rsi_overbought_runup():
    direction, _notes = direction_ensemble(
        3,
        exc_slope=-0.2,
        slope=-0.1,
        rsi_val=75,
        vol_ratio=1.0,
        vol_accel=1.0,
        run_up=22,
        slope_5d=-0.5,
        slope_20d=-0.4,
        run_up_7d=18,
        ath_prox=0.95,
    )
    assert direction.startswith("↓") or direction == "→ Stabile"


def test_confidence_bounds_and_tuple_compat():
    detail = direction_ensemble_detail(
        3,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=50,
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=3,
        slope_5d=1.0,
        slope_20d=0.8,
        pcr=0.55,
        exp_move_pct=30.0,
    )
    assert 0.0 <= detail.confidence <= 1.0
    label, _notes = direction_ensemble(
        3,
        2.0,
        1.8,
        50,
        2.5,
        2.2,
        3,
        1.0,
        0.8,
        pcr=0.55,
        exp_move_pct=30.0,
        return_detail=False,
    )
    assert label == detail.direction_label


def test_missing_options_lowers_confidence():
    with_opts = direction_ensemble_detail(
        3,
        exc_slope=1.8,
        slope=1.5,
        rsi_val=48,
        vol_ratio=2.0,
        vol_accel=1.8,
        run_up=5,
        slope_5d=0.8,
        slope_20d=0.6,
        pcr=1.2,
        exp_move_pct=18.0,
    )
    no_opts = direction_ensemble_detail(
        3,
        exc_slope=1.8,
        slope=1.5,
        rsi_val=48,
        vol_ratio=2.0,
        vol_accel=1.8,
        run_up=5,
        slope_5d=0.8,
        slope_20d=0.6,
        pcr=None,
        exp_move_pct=None,
    )
    assert no_opts.confidence <= with_opts.confidence
    assert any("no options" in n for n in no_opts.notes)


def test_return_detail_flag():
    result = direction_ensemble(
        3,
        1.0,
        1.0,
        50,
        1.2,
        1.1,
        0,
        0.5,
        0.4,
        return_detail=True,
    )
    assert hasattr(result, "confidence")
    assert result.bull_score >= 0
    assert result.bear_score >= 0
