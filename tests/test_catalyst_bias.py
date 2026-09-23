from catalyst_bias import BiasWeights, compute_bias_score, sign_rr


def test_sign_rr_thresholds():
    assert sign_rr(0.06) == 1
    assert sign_rr(-0.06) == -1
    assert sign_rr(0.01) == 0
    assert sign_rr(None) == 0


def test_bullish_build_label():
    out = compute_bias_score(
        rr10=0.08,
        price_vol_kind="together_up",
        insider_net_buy_30d=5000,
        relative_move=0.02,
    )
    assert out["status"] == "ok"
    assert out["bias_score"] is not None and out["bias_score"] > 0.3
    assert out["bias_label"] == "bullish_build"
    assert out["weights_note"] == "arbitrary_uncalibrated"


def test_fear_hedge_label():
    out = compute_bias_score(
        rr10=-0.08,
        price_vol_kind="together_down",
        insider_net_buy_30d=-1000,
        relative_move=-0.03,
    )
    assert out["bias_label"] == "fear_hedge"


def test_missing_all_inputs_is_none_not_zero():
    out = compute_bias_score()
    assert out["bias_score"] is None
    assert out["bias_label"] is None
    assert out["status"] == "none"


def test_weights_are_configurable():
    w = BiasWeights(w_rr=1.0, w_price_vol=0.0, w_insider=0.0, w_sector=0.0)
    out = compute_bias_score(rr10=0.08, weights=w)
    assert out["bias_score"] == 1.0
