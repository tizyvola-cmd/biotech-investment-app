from catalyst_short_interest import (
    borrow_fee_delta_5d,
    build_short_interest_row,
    days_to_cover,
    price_return_nd,
    si_delta_pct,
    squeeze_risk_flag,
    utilization,
)


def test_days_to_cover_formula():
    assert days_to_cover(420_000, 100_000) == 4.2
    assert days_to_cover(None, 100_000) is None
    assert days_to_cover(100, 0) is None


def test_si_delta_pct():
    assert si_delta_pct(110, 100) == 10.0
    assert si_delta_pct(90, 100) == -10.0
    assert si_delta_pct(110, None) is None
    assert si_delta_pct(110, 0) is None


def test_borrow_and_util_never_invented():
    assert borrow_fee_delta_5d(None, 0.02) is None
    assert borrow_fee_delta_5d(0.05, None) is None
    assert borrow_fee_delta_5d(0.05, 0.032) == 0.018
    assert utilization(None, 1_000) is None
    assert utilization(800, 1000) == 0.8


def test_squeeze_requires_all_three_inputs():
    assert squeeze_risk_flag(6.0, 0.018, 0.04) is True
    assert squeeze_risk_flag(4.0, 0.018, 0.04) is False
    assert squeeze_risk_flag(6.0, 0.0, 0.04) is False
    assert squeeze_risk_flag(6.0, 0.018, -0.01) is False
    # Missing borrow fee → cannot evaluate (do not treat as 0).
    assert squeeze_risk_flag(6.0, None, 0.04) is None
    assert squeeze_risk_flag(None, 0.018, 0.04) is None


def test_price_return_5d():
    closes = [10, 10.2, 10.1, 10.4, 10.5, 11.0]
    assert abs(price_return_nd(closes, 5) - 0.1) < 1e-9
    assert price_return_nd([10, 11], 5) is None


def test_row_builder_missing_loan_feed():
    row = build_short_interest_row(
        "AMGN",
        shares_short=500_000,
        shares_short_prior=400_000,
        volumes=[50_000] * 20,
        closes=[10, 10, 10, 10, 10, 11],
    )
    assert row["days_to_cover"] == 10.0
    assert row["si_delta_pct"] == 25.0
    assert row["borrow_fee_delta_5d"] is None
    assert row["utilization"] is None
    assert row["squeeze_risk"] is None
    assert row["borrow_feed"] is False
