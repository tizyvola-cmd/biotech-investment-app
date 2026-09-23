from event_vol_index import accelerating_flag, delta_slope_nd


def test_delta_slope_needs_six_points():
    assert delta_slope_nd([1, 2, 3, 4, 5], 5) is None
    assert abs(delta_slope_nd([1, 1, 1, 1, 1, 6], 5) - 1.0) < 1e-9


def test_accelerating_flag():
    assert accelerating_flag(0.2, 0.1) is True
    assert accelerating_flag(0.05, 0.1) is False
    assert accelerating_flag(0.2, None) is None
    assert accelerating_flag(None, 0.1) is None
