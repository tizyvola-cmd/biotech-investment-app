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


def test_resolve_unions_store_and_fallback(monkeypatch):
    # New contract: always union the persisted store with regime-tagged fallback
    # (deduped). The old "switch sources once the store crosses the threshold"
    # logic discontinuously collapsed the evaluation pool to a tiny, biased
    # subset (the RISK_ON over-funnel bug); union avoids that jump.
    monkeypatch.setattr(
        "prediction.regime_calibration.load_outcomes_with_regime",
        lambda: [
            {"pred": 1.0, "actual": 2.0, "regime": "RISK_ON", "ticker": "AAA", "date": "2026-01-01", "node": "T+5"}
        ],
    )
    monkeypatch.setattr(
        "prediction.regime_calibration.get_regime_at_date",
        lambda _d: "NEUTRAL",
    )
    fallback = [
        {"pred": 1.0, "actual": 2.0, "ticker": f"T{i}", "date": "2026-02-01", "node": "T+5"} for i in range(12)
    ]
    rows = resolve_regime_outcomes_for_learning(fallback)
    # 12 distinct fallback rows + 1 distinct stored row, none deduped.
    assert len(rows) == 13


def test_resolve_persisted_tag_wins_on_conflict(monkeypatch):
    # When the same outcome appears in both sources, the persisted (genuine)
    # regime tag wins and the row is deduped to one.
    monkeypatch.setattr(
        "prediction.regime_calibration.load_outcomes_with_regime",
        lambda: [
            {"pred": 3.0, "actual": 8.0, "regime": "RISK_OFF", "ticker": "AAA", "date": "2026-02-01", "node": "T+5"}
        ],
    )
    monkeypatch.setattr(
        "prediction.regime_calibration.get_regime_at_date",
        lambda _d: "NEUTRAL",
    )
    fallback = [{"pred": 1.0, "actual": 2.0, "ticker": "AAA", "date": "2026-02-01", "node": "T+5"}]
    rows = resolve_regime_outcomes_for_learning(fallback)
    assert len(rows) == 1
    assert rows[0]["regime"] == "RISK_OFF"
