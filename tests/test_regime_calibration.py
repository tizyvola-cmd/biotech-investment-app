"""Regime outcome pool backfill for learning."""
from __future__ import annotations

from prediction.regime_calibration import enrich_outcomes_with_regime, resolve_regime_outcomes_for_learning


def test_enrich_outcomes_with_regime_tags_missing(monkeypatch):
    monkeypatch.setattr(
        "prediction.regime_calibration.get_regime_at_date",
        lambda _d: "NEUTRAL",
    )
    rows = enrich_outcomes_with_regime([{"pred": 1.0, "actual": 2.0, "date": "2026-01-15"}])
    assert rows[0]["regime"] == "NEUTRAL"


def test_resolve_prefers_sparse_store_over_backfill(monkeypatch):
    monkeypatch.setattr(
        "prediction.regime_calibration.load_outcomes_with_regime",
        lambda: [{"pred": 1.0, "actual": 2.0, "regime": "RISK_ON", "date": "2026-01-01"}] * 8,
    )
    monkeypatch.setattr(
        "prediction.cluster_cal_factor.collect_resolved_outcomes_from_sources",
        lambda: (_ for _ in ()).throw(AssertionError("should not collect")),
    )
    rows = resolve_regime_outcomes_for_learning()
    assert len(rows) == 8
    assert rows[0]["regime"] == "RISK_ON"


def test_resolve_backfills_when_store_tiny(monkeypatch):
    monkeypatch.setattr(
        "prediction.regime_calibration.load_outcomes_with_regime",
        lambda: [{"pred": 3.0, "actual": 8.0, "regime": "NEUTRAL"}],
    )
    monkeypatch.setattr(
        "prediction.regime_calibration.get_regime_at_date",
        lambda _d: "NEUTRAL",
    )
    fallback = [{"pred": 1.0, "actual": 2.0, "date": "2026-02-01"}] * 12
    rows = resolve_regime_outcomes_for_learning(fallback)
    assert len(rows) == 12
    assert all(r["regime"] == "NEUTRAL" for r in rows)
