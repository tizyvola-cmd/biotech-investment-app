"""Tests for prediction.rescue_cause_attribution — volume anomaly + external alignment."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure repo root is on sys.path for imports
_REPO = Path(__file__).resolve().parents[2]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from prediction.rescue_cause_attribution import (
    compute_cause_attribution,
    compute_external_alignment,
    compute_volume_anomaly,
)


# ── Volume Anomaly ────────────────────────────────────────────────────────────

class TestVolumeAnomaly:
    def test_insufficient_history_returns_null(self):
        result = compute_volume_anomaly([100, 200, 300])
        assert result["status"] == "insufficient_history"
        assert result["score"] is None

    def test_normal_volume_low_score(self):
        # 20 days of flat 1M volume, today also 1M → z ≈ 0 → score ≈ 0
        vols = [1_000_000.0] * 20 + [1_000_000.0]
        result = compute_volume_anomaly(vols)
        assert result["status"] == "ok"
        assert result["score"] == 0.0

    def test_high_volume_spike_high_score(self):
        # 20 days of 1M, today 5M → z = (5M-1M)/std ≈ very high → score capped at 100
        vols = [1_000_000.0] * 20 + [5_000_000.0]
        result = compute_volume_anomaly(vols)
        assert result["status"] == "ok"
        assert result["score"] is not None
        assert result["score"] >= 60  # should be high

    def test_moderate_spike(self):
        # 20 days of varied volume (mean ~1M, std ~200K), today 2M → z ≈ 5 → score = 100
        import random
        random.seed(42)
        vols = [1_000_000 + random.gauss(0, 200_000) for _ in range(20)]
        vols.append(2_000_000)
        result = compute_volume_anomaly(vols)
        assert result["status"] == "ok"
        assert result["score"] is not None
        assert result["score"] > 40  # should be elevated

    def test_excludes_today_from_trailing(self):
        # Verify trailing window excludes the last element
        vols = [100.0] * 20 + [10_000.0]
        result = compute_volume_anomaly(vols)
        assert result["avg_volume_20d"] == 100.0  # trailing is all 100s


# ── External Alignment ────────────────────────────────────────────────────────

class TestExternalAlignment:
    def test_insufficient_history(self):
        result = compute_external_alignment([10, 11], [50, 51])
        assert result["status"] == "insufficient_history"
        assert result["score"] is None

    def test_perfectly_aligned(self):
        # Ticker and XBI move by exactly the same % → score = 100
        closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]
        xbi = [50.0, 50.5, 51.0, 51.5, 52.0, 52.5]
        result = compute_external_alignment(closes, xbi)
        assert result["status"] == "ok"
        assert result["score"] == 100.0

    def test_diverging_move(self):
        # Ticker drops 20%, XBI flat → gap = 20% → score = 100 - 20*4 = 20
        closes = [100.0, 98.0, 96.0, 92.0, 85.0, 80.0]
        xbi = [50.0, 50.0, 50.0, 50.0, 50.0, 50.0]
        result = compute_external_alignment(closes, xbi)
        assert result["status"] == "ok"
        assert result["score"] is not None
        assert result["score"] <= 30  # diverging → low external alignment

    def test_both_decline_same_rate(self):
        # Both drop ~10% over 5 days → aligned → high score
        closes = [100.0, 98.0, 96.0, 94.0, 92.0, 90.0]
        xbi = [50.0, 49.0, 48.0, 47.0, 46.0, 45.0]
        result = compute_external_alignment(closes, xbi)
        assert result["status"] == "ok"
        assert result["score"] is not None
        assert result["score"] >= 90  # both drop ~10%


# ── Combined ──────────────────────────────────────────────────────────────────

class TestCauseAttribution:
    def test_internal_flag(self):
        # High volume + divergence from sector → internal flag
        vols = [1_000_000.0] * 20 + [5_000_000.0]
        closes = [100.0, 98.0, 96.0, 92.0, 85.0, 80.0]  # -20%
        xbi = [50.0, 50.0, 50.0, 50.0, 50.0, 50.0]  # flat
        # Need enough closes for window=5
        full_closes = [100.0] * 16 + closes
        full_xbi = [50.0] * 16 + xbi
        result = compute_cause_attribution(full_closes, vols, full_xbi)
        assert result["volume_anomaly"]["score"] is not None
        assert result["external_alignment"]["score"] is not None
        # Volume is spiking AND not aligned with sector → internal
        assert result["internal_cause_flag"] is True
        assert result["external_cause_flag"] is False

    def test_external_flag(self):
        # Normal volume + aligned with sector decline → external flag
        vols = [1_000_000.0] * 21  # no spike
        closes = [100.0] * 16 + [100.0, 98.0, 96.0, 94.0, 92.0, 90.0]  # -10%
        xbi = [50.0] * 16 + [50.0, 49.0, 48.0, 47.0, 46.0, 45.0]  # -10%
        result = compute_cause_attribution(closes, vols, xbi)
        assert result["volume_anomaly"]["score"] is not None
        assert result["external_alignment"]["score"] is not None
        # Volume normal AND aligned → external
        assert result["external_cause_flag"] is True
        assert result["internal_cause_flag"] is False

    def test_insufficient_data(self):
        # Short series → both null → neither flag
        result = compute_cause_attribution([10, 11], [100, 200], [50, 51])
        assert result["internal_cause_flag"] is False
        assert result["external_cause_flag"] is False
