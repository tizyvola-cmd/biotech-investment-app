"""Tests for direction_ensemble v4.1 (confidence, Phase 2, options)."""
from prediction.direction_ensemble import direction_ensemble, direction_ensemble_detail


def test_phase2_strong_bull_not_forced_neutral():
    """Fase 2: segnali bull molto forti possono dare ↑ nonostante prior PoS bearish (41%).
    Con PoS Ph2 il modello aggiunge 1 bear prima del Phase2Factor, quindi serve un
    consenso tecnico più forte rispetto a prima per superare _PH2_NET_MILD=4."""
    detail = direction_ensemble_detail(
        2,
        exc_slope=2.0,
        slope=1.8,
        rsi_val=25,        # RSI oversold: +2 bull
        vol_ratio=2.5,
        vol_accel=2.2,
        run_up=-22,        # CTR forte: +2 bull
        slope_5d=1.0,
        slope_20d=0.8,
        pcr=3.0,           # PCR panico: +2 bull
    )
    assert detail.direction_label.startswith("↑")
    assert detail.phase == 2
    assert any("Ph2" in n for n in detail.notes)
    assert any("PoS" in n for n in detail.notes)


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


def test_strong_slope5d_adds_bull_independent():
    """slope5d >= 2.5 contribuisce +2 bull indipendentemente da slope20d."""
    detail = direction_ensemble_detail(
        3,
        exc_slope=0.0,
        slope=0.0,
        rsi_val=50,
        vol_ratio=1.0,
        vol_accel=1.0,
        run_up=0,
        slope_5d=2.8,   # >= 2.5 → +2 bull indipendente
        slope_20d=0.5,  # TF↑↑ → +1 aggiuntivo
    )
    assert detail.direction_label == "↑↑ Forte crescita"
    assert detail.net_score == 4
    assert any("s5d↑↑" in n for n in detail.notes)


def test_moderate_slope5d_adds_one_bull():
    """slope5d in [1.5, 2.5) contribuisce +1 bull."""
    detail = direction_ensemble_detail(
        3,
        exc_slope=0.0,
        slope=0.0,
        rsi_val=50,
        vol_ratio=1.0,
        vol_accel=1.0,
        run_up=0,
        slope_5d=1.8,   # >= 1.5 < 2.5 → +1 bull
        slope_20d=0.5,
    )
    assert detail.net_score >= 3  # PoS(+1) + TF↑↑(+1) + s5d↑(+1) = 3
    assert detail.direction_label.startswith("↑")
    assert any("s5d↑" in n and "↑↑" not in n for n in detail.notes)


def test_slope5d_partially_offsets_priced_in():
    """slope5d=2.0 aggiunge +1 bull, portando il net da 2 a 3 (→Stabile → ↑Crescita)."""
    # Stesso setup di phase3_priced_in_near_t (slope_5d=0.7 → net=2 → Stabile)
    # ma con slope_5d=2.0 → net=3 → Crescita lieve
    detail = direction_ensemble_detail(
        3,
        exc_slope=1.2,
        slope=1.0,
        rsi_val=55,
        vol_ratio=1.5,
        vol_accel=1.4,
        run_up=8,
        slope_5d=2.0,
        slope_20d=0.6,
        days_to_t=5,
    )
    assert detail.direction_label == "↑ Crescita lieve"
    assert detail.net_score == 3
    assert detail.bull_score == 5  # PoS(1)+exc_slope(1)+vol(1)+TF(1)+s5d↑(1)
