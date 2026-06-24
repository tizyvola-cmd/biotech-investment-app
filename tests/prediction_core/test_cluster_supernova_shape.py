from prediction.clustering import canonicalize_supernova_by_peak_shape


def test_peak_shape_swap_when_minority_is_flatter():
    cohort = ["A", "B", "C", "D"]
    features = {
        "A": [0.0, 80.0, 120.0, 130.0, 140.0, 150.0, 155.0, 160.0, 165.0, 170.0],
        "B": [0.0, 75.0, 110.0, 125.0, 135.0, 145.0, 150.0, 155.0, 160.0, 165.0],
        "C": [0.0, -1.0, -2.0, -2.5, -3.0, -3.0, -3.5, -4.0, -4.0, -4.5],
        "D": [0.0, -0.5, -1.5, -2.0, -2.5, -2.5, -3.0, -3.0, -3.5, -4.0],
    }
    assign = {"A": 0, "B": 0, "C": 1, "D": 1}
    out, keys, swapped = canonicalize_supernova_by_peak_shape(assign, cohort, features)
    assert swapped is True
    assert out["A"] == 1 and out["C"] == 0
    assert len(keys[1]) == 2


def test_peak_shape_no_swap_when_cluster1_already_surge():
    cohort = ["A", "B", "C", "D"]
    features = {
        "A": [0.0, -1.0, -2.0, -2.5, -3.0, -3.0, -3.5, -4.0, -4.0, -4.5],
        "B": [0.0, -0.5, -1.5, -2.0, -2.5, -2.5, -3.0, -3.0, -3.5, -4.0],
        "C": [0.0, 80.0, 120.0, 130.0, 140.0, 150.0, 155.0, 160.0, 165.0, 170.0],
        "D": [0.0, 75.0, 110.0, 125.0, 135.0, 145.0, 150.0, 155.0, 160.0, 165.0],
    }
    assign = {"A": 0, "B": 0, "C": 1, "D": 1}
    out, _keys, swapped = canonicalize_supernova_by_peak_shape(assign, cohort, features)
    assert swapped is False
    assert out == assign
