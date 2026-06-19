from ristretta_lab_data import _swap_cluster_ref_means_if_inverted


def test_swap_when_majority_curve_is_surge_but_labeled_cluster0():
    flat = [0.0, -1.0, -2.0, -2.5, -3.0, -3.0, -3.5, -4.0, -4.0, -4.5]
    surge = [0.0, 50.0, 90.0, 100.0, 110.0, 115.0, 118.0, 120.0, 122.0, 125.0]
    m0, m1 = _swap_cluster_ref_means_if_inverted(surge, flat)
    assert m0 == flat
    assert m1 == surge


def test_no_swap_when_cluster1_already_surge():
    flat = [0.0, -1.0, -2.0, -2.5, -3.0, -3.0, -3.5, -4.0, -4.0, -4.5]
    surge = [0.0, 50.0, 90.0, 100.0, 110.0, 115.0, 118.0, 120.0, 122.0, 125.0]
    m0, m1 = _swap_cluster_ref_means_if_inverted(flat, surge)
    assert m0 == flat
    assert m1 == surge
