"""Tests per slope_contrarian_calib — feedback loop slope5d."""
import math

import pytest

from prediction.slope_contrarian_calib import (
    compute_contrarian_calibration,
    _slope_win_to_weight,
    WEIGHT_NEUTRAL,
    WEIGHT_MIN,
    WEIGHT_MAX,
    MIN_CASES,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_rows(
    n: int,
    slope5d: float,
    dir_v4: str,
    d5_pct: float,
) -> list[dict]:
    return [
        {"slope_5d": slope5d, "dir_v4": dir_v4, "d5_pct": d5_pct}
        for _ in range(n)
    ]


# ── _slope_win_to_weight ─────────────────────────────────────────────────────

def test_weight_neutral_at_50pct():
    assert _slope_win_to_weight(0.50) == pytest.approx(1.0)


def test_weight_high_when_slope_reliable():
    w = _slope_win_to_weight(0.70)
    assert w > 1.0
    assert w <= WEIGHT_MAX


def test_weight_low_when_model_reliable():
    w = _slope_win_to_weight(0.30)
    assert w < 1.0
    assert w >= WEIGHT_MIN


def test_weight_clamp_max():
    assert _slope_win_to_weight(1.0) == WEIGHT_MAX


def test_weight_clamp_min():
    assert _slope_win_to_weight(0.0) == WEIGHT_MIN


def test_weight_nan_returns_neutral():
    assert _slope_win_to_weight(float("nan")) == WEIGHT_NEUTRAL


# ── compute_contrarian_calibration ───────────────────────────────────────────

def test_empty_rows_returns_neutral_weight():
    result = compute_contrarian_calibration([])
    assert result["combined_s5d_weight"] == WEIGHT_NEUTRAL
    assert result["n_contrarian_total"] == 0


def test_no_contrarian_cases_returns_neutral():
    # Slope e direzione concordano — nessun caso contrarian
    rows = _make_rows(20, slope5d=2.0, dir_v4="↑↑ Forte crescita", d5_pct=5.0)
    result = compute_contrarian_calibration(rows)
    assert result["n_contrarian_total"] == 0
    assert result["combined_s5d_weight"] == WEIGHT_NEUTRAL


def test_model_down_slope_always_wins():
    """slope5d ↑ forte, modello ↓, price sempre sale → slope sempre giusta."""
    rows = _make_rows(MIN_CASES + 5, slope5d=2.0, dir_v4="↓ Calo lieve", d5_pct=5.0)
    result = compute_contrarian_calibration(rows)
    md = result["model_down"]
    assert md["slope_win_rate"] == pytest.approx(1.0)
    assert md["model_win_rate"] == pytest.approx(0.0)
    assert md["s5d_weight"] > 1.0
    assert result["combined_s5d_weight"] > 1.0


def test_model_down_model_always_wins():
    """slope5d ↑ forte, modello ↓, price sempre scende → modello sempre giusto."""
    rows = _make_rows(MIN_CASES + 5, slope5d=2.0, dir_v4="↓↓ Calo forte", d5_pct=-5.0)
    result = compute_contrarian_calibration(rows)
    md = result["model_down"]
    assert md["model_win_rate"] == pytest.approx(1.0)
    assert md["slope_win_rate"] == pytest.approx(0.0)
    assert md["s5d_weight"] < 1.0
    assert result["combined_s5d_weight"] < 1.0


def test_model_up_slope_always_wins():
    """slope5d ↓ forte, modello ↑, price sempre scende → slope sempre giusta."""
    rows = _make_rows(MIN_CASES + 5, slope5d=-2.0, dir_v4="↑ Crescita lieve", d5_pct=-5.0)
    result = compute_contrarian_calibration(rows)
    mu = result["model_up"]
    assert mu["slope_win_rate"] == pytest.approx(1.0)
    assert mu["s5d_weight"] > 1.0


def test_below_min_cases_weight_stays_neutral():
    """Con meno di MIN_CASES casi, non usiamo il weight calibrato."""
    rows = _make_rows(MIN_CASES - 1, slope5d=2.0, dir_v4="↓ Calo lieve", d5_pct=5.0)
    result = compute_contrarian_calibration(rows)
    assert result["model_down"]["s5d_weight"] == WEIGHT_NEUTRAL
    # combined deve comunque restare neutro
    assert result["combined_s5d_weight"] == WEIGHT_NEUTRAL


def test_missing_fields_skipped():
    rows = [
        {"slope_5d": None, "dir_v4": "↓ Calo lieve", "d5_pct": 5.0},
        {"slope_5d": 2.0,  "dir_v4": "↓ Calo lieve", "d5_pct": None},
        {"slope_5d": "bad","dir_v4": "↓ Calo lieve", "d5_pct": 5.0},
        {"slope_5d": float("nan"), "dir_v4": "↓ Calo lieve", "d5_pct": 5.0},
    ]
    result = compute_contrarian_calibration(rows)
    assert result["n_contrarian_total"] == 0


def test_combined_weight_respects_bounds():
    """Il peso combinato deve sempre stare in [WEIGHT_MIN, WEIGHT_MAX]."""
    rows = (
        _make_rows(20, slope5d=3.0,  dir_v4="↓↓ Calo forte",   d5_pct=10.0)  # slope vince sempre
      + _make_rows(20, slope5d=-3.0, dir_v4="↑↑ Forte crescita", d5_pct=-10.0)
    )
    result = compute_contrarian_calibration(rows)
    w = result["combined_s5d_weight"]
    assert WEIGHT_MIN <= w <= WEIGHT_MAX


def test_outcome_in_noise_zone_not_counted():
    """Outcome entro ±2% (noise) non viene contato come vincita né perdita."""
    # Tutti gli outcome cadono nella zona rumore → win rate = 0 per entrambi
    rows = _make_rows(MIN_CASES + 5, slope5d=2.0, dir_v4="↓ Calo lieve", d5_pct=1.0)
    result = compute_contrarian_calibration(rows)
    md = result["model_down"]
    assert md["slope_win_rate"] == pytest.approx(0.0)
    assert md["model_win_rate"] == pytest.approx(0.0)
