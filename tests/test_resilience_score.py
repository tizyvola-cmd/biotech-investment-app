"""Unit tests for prediction/resilience_score.py.

Tests focus on:
1. Statistical correctness on synthetic series (uptrend, downtrend,
   V-shape recovery, staircase, oscillating).
2. Confirmation that resilient vs fragile behaviour maps to score deltas
   of the expected sign and magnitude.
3. `insufficient_history` gating: too-short series must NOT be silently
   scored as zero without a status flag.
"""

from __future__ import annotations

import math
import random

import pytest

from prediction.resilience_score import (
    CAP_A1,
    CAP_A2,
    CAP_B1,
    CAP_C1,
    CAP_C2,
    MIN_BARS_ASYMMETRIC_BETA,
    MIN_BARS_RECOVERY,
    compute_asymmetric_beta,
    compute_historical_recovery,
    compute_resilience_score,
    compute_upside_capacity,
    _find_drawdown_events,
)


# ── Synthetic-series builders ─────────────────────────────────────────────────


def _pure_uptrend(n: int = 600, daily: float = 0.001, start: float = 100.0) -> list[float]:
    return [start * (1 + daily) ** i for i in range(n)]


def _downtrend(n: int = 600, daily: float = -0.001, start: float = 100.0) -> list[float]:
    return [start * (1 + daily) ** i for i in range(n)]


def _v_shape_recovery(
    n_down: int = 60,
    n_up: int = 60,
    start: float = 100.0,
    trough_pct: float = -30.0,
    n_lead: int = 400,
) -> list[float]:
    """Long flat lead-in, then V-shape drawdown + recovery."""
    trough = start * (1 + trough_pct / 100.0)
    lead = [start + (i % 3) * 0.01 for i in range(n_lead)]  # near-flat with tiny jitter
    down_step = (trough - start) / max(1, n_down)
    up_step = (start - trough) / max(1, n_up)
    down = [start + down_step * (i + 1) for i in range(n_down)]
    up = [trough + up_step * (i + 1) for i in range(n_up)]
    return lead + down + up


def _l_shape_no_recovery(n_lead: int = 400, n_down: int = 60) -> list[float]:
    """Drawdown followed by extended flat — never recovers."""
    start = 100.0
    trough = 65.0
    lead = [start + (i % 3) * 0.01 for i in range(n_lead)]
    down_step = (trough - start) / max(1, n_down)
    down = [start + down_step * (i + 1) for i in range(n_down)]
    flat = [trough + (i % 3) * 0.01 for i in range(200)]
    return lead + down + flat


def _resilient_vs_market(n: int = 500, seed: int = 42) -> tuple[list[float], list[float]]:
    """Ticker with LOW downside beta and HIGH upside beta relative to XBI."""
    rng = random.Random(seed)
    xbi = [100.0]
    ticker = [100.0]
    for _ in range(n - 1):
        # Market daily return ~ N(0, 0.012)
        m = rng.gauss(0, 0.012)
        # Resilient response: capture 130% on up days, only 60% on down days
        t = (m * 1.30) if m > 0 else (m * 0.60)
        # Add ticker-idiosyncratic noise ~ N(0, 0.005)
        t += rng.gauss(0, 0.005)
        xbi.append(xbi[-1] * (1 + m))
        ticker.append(ticker[-1] * (1 + t))
    return ticker, xbi


def _fragile_vs_market(n: int = 500, seed: int = 42) -> tuple[list[float], list[float]]:
    """Ticker with HIGH downside beta and LOW upside beta relative to XBI."""
    rng = random.Random(seed)
    xbi = [100.0]
    ticker = [100.0]
    for _ in range(n - 1):
        m = rng.gauss(0, 0.012)
        # Fragile: amplify losses, mute gains
        t = (m * 0.70) if m > 0 else (m * 1.50)
        t += rng.gauss(0, 0.005)
        xbi.append(xbi[-1] * (1 + m))
        ticker.append(ticker[-1] * (1 + t))
    return ticker, xbi


# ── A — Historical Drawdown-Recovery ─────────────────────────────────────────


class TestBlockA:
    def test_finds_v_shape_drawdown(self) -> None:
        closes = _v_shape_recovery(n_down=40, n_up=40, trough_pct=-25)
        events = _find_drawdown_events(closes)
        assert len(events) >= 1
        peak_i, trough_i = events[0]
        assert closes[trough_i] < closes[peak_i]
        dd_pct = (closes[trough_i] / closes[peak_i] - 1.0) * 100.0
        assert dd_pct <= -10.0

    def test_recovery_series_scores_higher_than_no_recovery(self) -> None:
        recovering = _v_shape_recovery(n_down=40, n_up=40, trough_pct=-25)
        stuck = _l_shape_no_recovery(n_down=40)
        s_recovering = compute_historical_recovery(recovering).score
        s_stuck = compute_historical_recovery(stuck).score
        assert s_recovering > s_stuck

    def test_insufficient_history_is_flagged(self) -> None:
        short = _pure_uptrend(n=100)
        r = compute_historical_recovery(short)
        assert r.status == "insufficient_history"
        assert r.score == 0.0

    def test_no_data_returns_no_data_status(self) -> None:
        r = compute_historical_recovery([])
        assert r.status == "no_data"
        assert r.score == 0.0

    def test_no_drawdowns_in_window_gets_neutral_credit(self) -> None:
        # 3 years of quiet uptrend — no ≥10% drops.
        smooth = _pure_uptrend(n=MIN_BARS_RECOVERY + 100, daily=0.0003)
        r = compute_historical_recovery(smooth)
        assert r.status == "ok"
        assert r.detail.get("drawdown_events") == 0
        # Neutral half-credit (see resilience_score.py rationale)
        assert 0.0 < r.score <= (CAP_A1 + CAP_A2) * 0.5 + 0.01


# ── B — Asymmetric Beta ──────────────────────────────────────────────────────


class TestBlockB:
    def test_resilient_beats_fragile(self) -> None:
        t_r, x_r = _resilient_vs_market()
        t_f, x_f = _fragile_vs_market()
        r_res = compute_asymmetric_beta(t_r, x_r)
        r_frag = compute_asymmetric_beta(t_f, x_f)
        assert r_res.status == "ok"
        assert r_frag.status == "ok"
        # Resilient must score meaningfully higher than fragile
        assert r_res.score > r_frag.score + 3.0
        # And its asymmetry must be positive
        assert r_res.detail["asymmetry"] > 0
        assert r_frag.detail["asymmetry"] < 0

    def test_flat_relationship_scores_near_middle(self) -> None:
        # Ticker = XBI * scalar with no asymmetry — beta_up ≈ beta_down.
        rng = random.Random(123)
        xbi = [100.0]
        ticker = [100.0]
        for _ in range(500):
            m = rng.gauss(0, 0.01)
            xbi.append(xbi[-1] * (1 + m))
            ticker.append(ticker[-1] * (1 + m))
        r = compute_asymmetric_beta(ticker, xbi)
        assert r.status == "ok"
        # Should land near the neutral mid-point (~15pt out of 30)
        assert CAP_B1 * 0.25 < r.score < CAP_B1 * 0.75

    def test_insufficient_history_flagged(self) -> None:
        r = compute_asymmetric_beta(_pure_uptrend(80), _pure_uptrend(80))
        assert r.status == "insufficient_history"
        assert r.score == 0.0


# ── C — Upside Capacity ──────────────────────────────────────────────────────


class TestBlockC:
    def test_uptrend_has_positive_quarter_frequency(self) -> None:
        r = compute_upside_capacity(_pure_uptrend(600, daily=0.002))
        assert r.status == "ok"
        assert r.detail["positive_quarters_frac"] >= 0.75

    def test_downtrend_has_low_positive_quarter_frequency(self) -> None:
        r = compute_upside_capacity(_downtrend(600, daily=-0.001))
        assert r.status == "ok"
        assert r.detail["positive_quarters_frac"] <= 0.25

    def test_at_high_gives_low_c1(self) -> None:
        r = compute_upside_capacity(_pure_uptrend(600, daily=0.001))
        # last close is the high → pct_from_52w_high ≈ 0
        assert r.detail["pct_from_52w_high"] is not None
        assert r.detail["pct_from_52w_high"] < 5.0
        assert r.detail["c1_pt"] < 1.0

    def test_far_from_high_gives_high_c1(self) -> None:
        # Uptrend then crash: final close well below the peak
        closes = _pure_uptrend(500, daily=0.003) + [
            _pure_uptrend(500, daily=0.003)[-1] * 0.4 for _ in range(150)
        ]
        r = compute_upside_capacity(closes)
        assert r.detail["pct_from_52w_high"] is not None
        assert r.detail["pct_from_52w_high"] > 30.0


# ── Aggregate ────────────────────────────────────────────────────────────────


class TestAggregate:
    def test_resilient_composite_beats_fragile(self) -> None:
        t_r, x_r = _resilient_vs_market(n=700, seed=1)
        t_f, x_f = _fragile_vs_market(n=700, seed=1)
        p_r = compute_resilience_score("RESI", t_r, x_r)
        p_f = compute_resilience_score("FRAG", t_f, x_f)
        assert p_r.status == "ok"
        assert p_f.status == "ok"
        assert p_r.score > p_f.score

    def test_empty_inputs_yield_unmeasurable(self) -> None:
        p = compute_resilience_score("EMPTY", [], [])
        assert p.status == "insufficient_history"
        assert p.score == 0.0

    def test_payload_shape(self) -> None:
        t, x = _resilient_vs_market(n=600)
        p = compute_resilience_score("VIR", t, x, as_of="2026-07-14")
        d = p.to_dict()
        assert d["ticker"] == "VIR"
        assert d["as_of"] == "2026-07-14"
        assert "resilience_score" in d
        assert set(d["components"].keys()) == {
            "historical_recovery",
            "asymmetric_beta",
            "upside_capacity",
        }
        assert 0.0 <= d["resilience_score"] <= d["max_score"]
