"""Smoke tests for calibration helpers."""
from prediction.calibration import calib_bias


def test_calib_bias_empty():
    assert calib_bias([]) == {"n": 0, "d3": 0.0, "d5": 0.0, "d10": 0.0, "d30": 0.0}


def test_calib_bias_averages_errors():
    records = [
        {"status": "complete", "d3_err": 2.0, "d5_err": 4.0, "d10_err": 6.0, "d30_err": 8.0},
        {"status": "complete", "d3_err": 4.0, "d5_err": 6.0, "d10_err": 8.0, "d30_err": 10.0},
    ]
    b = calib_bias(records)
    assert b["n"] == 2
    assert b["d3"] == 3.0
    assert b["d30"] == 9.0
