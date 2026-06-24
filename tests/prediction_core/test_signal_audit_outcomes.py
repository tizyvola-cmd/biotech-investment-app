"""Tests for signal audit outcome closing."""
from __future__ import annotations

from datetime import date

from prediction.signal_audit import (
    OUTCOME_HORIZON_BD,
    _audit_bars_by_ticker,
    _close_on_or_after,
    close_pending_outcomes,
)


def test_audit_bars_from_log_prices():
    rows = [
        {"ticker": "AAA", "log_date": "2026-05-29", "price_t0": 10.0, "direction": "up", "signal_emitted": True},
        {"ticker": "AAA", "log_date": "2026-05-30", "price_t0": 10.2},
        {"ticker": "AAA", "log_date": "2026-06-02", "price_t0": 10.4},
        {"ticker": "AAA", "log_date": "2026-06-03", "price_t0": 10.5},
        {"ticker": "AAA", "log_date": "2026-06-04", "price_t0": 10.6},
        {"ticker": "AAA", "log_date": "2026-06-05", "price_t0": 10.8},
        {"ticker": "AAA", "log_date": "2026-06-06", "price_t0": 11.0},
    ]
    bars = _audit_bars_by_ticker(rows)
    assert len(bars["AAA"]) >= OUTCOME_HORIZON_BD + 2
    pct = _close_on_or_after(bars["AAA"], date(2026, 5, 29), OUTCOME_HORIZON_BD)
    assert pct is not None
    assert pct > 0


def test_close_pending_outcomes_uses_audit_log():
    rows = [
        {
            "ticker": "AAA",
            "log_date": "2026-05-29",
            "price_t0": 10.0,
            "direction": "up",
            "signal_emitted": True,
            "pred5_pp": 3.0,
            "affid": 80,
        },
        {"ticker": "AAA", "log_date": "2026-05-30", "price_t0": 10.2},
        {"ticker": "AAA", "log_date": "2026-06-02", "price_t0": 10.4},
        {"ticker": "AAA", "log_date": "2026-06-03", "price_t0": 10.5},
        {"ticker": "AAA", "log_date": "2026-06-04", "price_t0": 10.6},
        {"ticker": "AAA", "log_date": "2026-06-05", "price_t0": 10.8},
        {"ticker": "AAA", "log_date": "2026-06-06", "price_t0": 11.0},
    ]
    n = close_pending_outcomes(rows, today=date(2026, 6, 12), min_days_since_log=6)
    assert n >= 1
    assert rows[0]["actual_5d_pct"] is not None
    assert rows[0]["hit"] is True
    assert rows[0]["outcome_source"] == "audit_log"
