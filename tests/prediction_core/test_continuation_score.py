"""Unit tests for P(continuation) v2 — sell-only exhaustion analogues."""
from __future__ import annotations

import numpy as np
import pandas as pd

from prediction.continuation_score import (
    AnalogueLibrary,
    band_for_dynamic,
    blend_own_pop,
    bucket_base_exhaustion_rate,
    build_percentile_continuation_curve,
    empirical_continuation_rate,
    extract_analogue_pairs,
    forward_drawdown_label,
    g10_bucket_lo,
    growth_pct,
    interpolate_curve_p,
    rate_matches,
    rate_percentile_among,
    sample_p_continuation_distribution,
    score_from_library,
    sell_timing_hint,
    DRAWDOWN_Y_PCT,
    P_CONT_SELL_MIN_G,
)


def _closes_trending(n: int = 200, start: float = 10.0, daily: float = 0.002) -> pd.Series:
    idx = pd.bdate_range("2023-01-02", periods=n)
    vals = [start]
    for _ in range(1, n):
        vals.append(vals[-1] * (1.0 + daily))
    return pd.Series(vals, index=idx)


def _closes_with_mean_revert_spikes(n: int = 400) -> pd.Series:
    """Quiet drift + periodic spikes that usually fade (exhaustion often true)."""
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2022-01-03", periods=n)
    vals = [10.0]
    for i in range(1, n):
        shock = 0.08 if i % 40 == 0 else 0.0
        vals.append(vals[-1] * (1.0 + 0.0003 + shock + float(rng.normal(0, 0.005))))
    return pd.Series(vals, index=idx)


def test_growth_basic():
    s = _closes_trending(60, daily=0.01)
    g10 = growth_pct(s.to_list(), 10)
    assert g10 is not None and g10 > 0


def test_forward_drawdown_label():
    assert forward_drawdown_label(100.0, np.array([99.0, 98.0, 94.0, 97.0, 96.0]), y_pct=5) == 1.0
    assert forward_drawdown_label(100.0, np.array([101.0, 102.0, 99.0, 100.0, 103.0]), y_pct=5) == 0.0


def test_extract_analogue_pairs_sell_only_and_drawdown_y():
    s = _closes_with_mean_revert_spikes(200)
    g, y = extract_analogue_pairs(s, stride=1)
    assert g.size == y.size
    assert g.size > 5
    assert np.all(g >= P_CONT_SELL_MIN_G)
    assert set(np.unique(y)).issubset({0.0, 1.0})


def test_rate_matches_same_sign_and_tolerance():
    assert rate_matches(12.0, 10.0)
    assert not rate_matches(-12.0, 10.0)
    assert not rate_matches(40.0, 10.0)


def test_empirical_rate_and_bucket_base():
    # Mild rise: less often exhausts; hot rise: often exhausts (drawdown label).
    g = np.array([6.0] * 40 + [22.0] * 40)
    y = np.array([1.0] * 10 + [0.0] * 30 + [1.0] * 30 + [0.0] * 10)
    p_mild, n_mild = empirical_continuation_rate(6.0, g, y, min_n=10)
    p_hot, n_hot = empirical_continuation_rate(22.0, g, y, min_n=10)
    assert n_mild >= 10 and n_hot >= 10
    assert p_mild is not None and p_hot is not None
    assert p_hot > p_mild
    p_base, n_base, lo = bucket_base_exhaustion_rate(6.0, g, y, min_n=10)
    assert p_base is not None and n_base >= 10
    assert lo == g10_bucket_lo(6.0)


def test_blend_and_dynamic_band_on_edge():
    blended = blend_own_pop(40.0, 10, 60.0, prior_n=20)
    assert blended is not None
    assert abs(blended - (10 * 40 + 20 * 60) / 30) < 0.15
    # high exhaustion vs base → high; low exhaustion → low
    assert band_for_dynamic(60.0, 50.0) == "high"
    assert band_for_dynamic(40.0, 50.0) == "low"
    assert band_for_dynamic(52.0, 50.0) == "mid"


def test_sell_timing_edge_above_bucket_base():
    assert (
        sell_timing_hint(55.0, mtm_pct=5.0, p_base=50.0, g10=12.0)
        == "exhaustion_edge_above_bucket_base"
    )
    assert sell_timing_hint(45.0, mtm_pct=5.0, p_base=50.0, g10=12.0) is None
    assert sell_timing_hint(55.0, mtm_pct=-1.0, p_base=50.0, g10=12.0) is None
    assert sell_timing_hint(55.0, mtm_pct=5.0, p_base=50.0, g10=2.0) is None
    assert (
        sell_timing_hint(None, mtm_pct=5.0, p_base=None, g10=12.0, sell_edge=1.5)
        == "exhaustion_edge_above_bucket_base"
    )


def test_score_skips_g10_below_threshold():
    s = _closes_trending(80, daily=0.001)  # mild; g10 may be small
    g, y = extract_analogue_pairs(s, stride=1, min_g=0.0)  # allow building lib
    # Force a flat series so g10 < 5
    flat = _closes_trending(80, daily=0.0)
    # Enough rising analogues for decile bins (min_n=30 per bin).
    pop_g = np.concatenate([np.full(40, float(g)) for g in (6, 7, 8, 10, 12, 14, 16, 18, 20, 22)])
    pop_y = np.tile(np.array([1.0, 0.0, 1.0, 0.0]), pop_g.size // 4 + 1)[: pop_g.size]
    lib = AnalogueLibrary(pop_g=pop_g, pop_y=pop_y, by_ticker={})
    sc = score_from_library("AAA", flat, lib)
    # daily=0 → g10 ~ 0
    assert sc.p_continuation is None
    assert sc.reason in {"g10_below_sell_threshold", "no_g10", "insufficient_analogues"}
    # Out-of-regime still carries population reference curve + chart percentile
    # (placement on the half-bell); sell edge stays off.
    if sc.reason == "g10_below_sell_threshold":
        assert sc.features.curve_pop  # non-empty reference curve
        assert sc.features.sell_edge is None
        if sc.features.g10 is not None and sc.features.g10 >= 0:
            assert sc.features.pct_pop_rate is not None


def test_own_curve_adapts_for_thin_library():
    """Thin Own (~40–70 events) still yields a multi-point curve (not Pop-only)."""
    from prediction.continuation_score import build_own_percentile_continuation_curve

    # 50 events across rising rates — old fixed deciles @ min_n=8 emptied Own.
    g = np.concatenate([np.full(5, float(x)) for x in range(6, 16)])
    y = np.tile(np.array([1.0, 0.0, 1.0, 0.0, 1.0]), 10)
    curve = build_own_percentile_continuation_curve(g, y)
    assert len(curve) >= 3
    assert all("pct" in pt and "p" in pt for pt in curve)


def test_below_threshold_ships_own_curve_when_library_present():
    rising = _closes_with_mean_revert_spikes(280)
    g, y = extract_analogue_pairs(rising, stride=1)
    assert g.size >= 40
    flat = _closes_trending(100, daily=0.0005)  # early-run g10 < 5
    pop_g = np.concatenate([np.full(40, float(gv)) for gv in (6, 8, 10, 12, 14, 16, 18, 20, 22, 24)])
    pop_y = np.tile(np.array([1.0, 0.0, 1.0, 0.0]), pop_g.size // 4 + 1)[: pop_g.size]
    lib = AnalogueLibrary(pop_g=pop_g, pop_y=pop_y, by_ticker={"VIRX": (g, y)})
    sc = score_from_library("VIRX", flat, lib)
    assert sc.reason == "g10_below_sell_threshold"
    assert sc.features.curve_pop
    assert sc.features.curve_own, "early-run should still ship Own geometry"


def test_score_from_library_on_synthetic():
    s = _closes_with_mean_revert_spikes(300)
    g, y = extract_analogue_pairs(s, stride=1)
    assert g.size > 30
    lib = AnalogueLibrary(pop_g=g, pop_y=y, by_ticker={"AAA": (g, y)})
    sc = score_from_library("AAA", s, lib)
    assert sc.features.g10 is not None
    if sc.features.g10 is not None and sc.features.g10 >= P_CONT_SELL_MIN_G:
        assert sc.p_continuation is not None or sc.reason == "insufficient_analogues"
        if sc.p_continuation is not None:
            assert sc.features.p_base is not None
            assert sc.features.sell_edge is not None
            assert abs(sc.features.sell_edge - (sc.p_continuation - sc.features.p_base)) < 0.15
            assert 0 <= sc.p_continuation <= 100
    assert DRAWDOWN_Y_PCT == 5.0


def test_sample_p_distribution_has_mu_sigma():
    # Several distinct rising rates so sampling across 0.5pp buckets has n≥4.
    chunks_g = [np.full(40, float(g)) for g in (6, 8, 12, 16, 20, 24)]
    chunks_y = [
        np.concatenate([np.ones(10), np.zeros(30)]),
        np.concatenate([np.ones(12), np.zeros(28)]),
        np.concatenate([np.ones(18), np.zeros(22)]),
        np.concatenate([np.ones(22), np.zeros(18)]),
        np.concatenate([np.ones(28), np.zeros(12)]),
        np.concatenate([np.ones(30), np.zeros(10)]),
    ]
    g = np.concatenate(chunks_g)
    y = np.concatenate(chunks_y)
    mu, sigma, n = sample_p_continuation_distribution(
        g, y, max_samples=40, min_analogue=5, min_n=4
    )
    assert n >= 4
    assert mu is not None and sigma is not None
    assert 0 <= mu <= 100
    assert sigma > 0


def test_percentile_continuation_curve_declines_with_extreme_rate():
    """Higher rate percentiles → lower P(continuation) when exhaustion rises with g."""
    # Mild rates rarely exhaust; hot rates often exhaust.
    g = np.concatenate([np.full(80, 6.0), np.full(80, 8.0), np.full(80, 20.0), np.full(80, 28.0)])
    y = np.concatenate(
        [
            np.concatenate([np.ones(16), np.zeros(64)]),  # 20% exh → 80% cont
            np.concatenate([np.ones(24), np.zeros(56)]),  # 30%
            np.concatenate([np.ones(48), np.zeros(32)]),  # 60%
            np.concatenate([np.ones(64), np.zeros(16)]),  # 80%
        ]
    )
    curve = build_percentile_continuation_curve(g, y, n_bins=4, min_n=30, smooth_window=1)
    assert len(curve) >= 2
    assert all(0 <= float(pt["p"]) <= 100 for pt in curve)
    # First bin (milder) should have higher continuation than last (extreme).
    assert float(curve[0]["p"]) > float(curve[-1]["p"])
    pct = rate_percentile_among(28.0, g)
    assert pct is not None and pct > 50
    p_at = interpolate_curve_p(curve, pct)
    assert p_at is not None
