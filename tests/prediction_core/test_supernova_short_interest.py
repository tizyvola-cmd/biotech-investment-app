"""Short interest component scoring for SDS cluster B."""
from __future__ import annotations

from prediction.supernova_score import short_interest_component_score, short_interest_detail


def test_short_squeeze_positive_momentum():
    assert short_interest_component_score(25.0, momentum_positive=True, days_to_cover=8.0) == 10.0


def test_short_high_momentum_low_dtc():
    assert short_interest_component_score(25.0, momentum_positive=True, days_to_cover=3.0) == 7.0


def test_short_high_negative_momentum():
    assert short_interest_component_score(25.0, momentum_positive=False) == -5.0


def test_short_moderate():
    assert short_interest_component_score(16.0, momentum_positive=True) == 5.0


def test_short_low():
    assert short_interest_component_score(6.0, momentum_positive=True) == 1.0


def test_short_missing_returns_none():
    assert short_interest_component_score(None, momentum_positive=True) is None


def test_short_squeeze_flags():
    d = short_interest_detail(22.0, days_to_cover=6.0, momentum_positive=True)
    assert d["squeeze_setup"] is True
    assert d["score"] == 10.0
