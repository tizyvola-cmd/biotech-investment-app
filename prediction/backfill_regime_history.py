"""Reconstruct ``regime_history.json`` from historical XBI / TLT / VIX prices.

The regime multiplier needs to know which market regime was in force on each past
prediction date. Going forward ``market_context_gate.run`` records this daily, but
historical outcomes predate that. This builder replays the *same* deterministic
classifier (``market_context_gate.classify_regime`` with the same thresholds) over
historical price series to fill the gap.

It never overwrites an already-recorded day unless ``overwrite=True`` — recorded
days reflect the live classification at the time and take precedence.

CLI::

    python -m prediction.backfill_regime_history            # fill missing days
    python -m prediction.backfill_regime_history --overwrite  # rebuild all
"""
from __future__ import annotations

import logging
from typing import Any

from prediction.market_context_gate import classify_regime

logger = logging.getLogger(__name__)


def _pct_return(closes: list[float], end_idx: int, days: int) -> float | None:
    """Percent return over ``days`` sessions ending at ``end_idx`` (inclusive)."""
    start = end_idx - days
    if start < 0:
        return None
    old = closes[start]
    new = closes[end_idx]
    if old <= 0:
        return None
    return round((new - old) / old * 100.0, 4)


def build_history_from_series(
    dates: list[str],
    xbi_closes: list[float],
    tlt_closes: list[float],
    vix_levels: list[float | None],
) -> dict[str, str]:
    """Classify the regime for each date from aligned daily series.

    All four lists must be aligned by trading day and share the same length.
    Days without enough trailing history for the 20-day window are skipped (the
    classifier cannot be reproduced faithfully without its inputs).
    """
    n = len(dates)
    if not (len(xbi_closes) == len(tlt_closes) == len(vix_levels) == n):
        raise ValueError("dates, xbi, tlt and vix series must be aligned and equal length")

    out: dict[str, str] = {}
    for i in range(n):
        x5 = _pct_return(xbi_closes, i, 5)
        x20 = _pct_return(xbi_closes, i, 20)
        t5 = _pct_return(tlt_closes, i, 5)
        if x5 is None or x20 is None:
            continue  # insufficient trailing history to reproduce the gate
        signals: dict[str, Any] = {
            "xbi_5d_return": x5,
            "xbi_20d_return": x20,
            "tlt_5d_return": t5,
            "vix_level": vix_levels[i],
        }
        out[str(dates[i])[:10]] = classify_regime(signals)
    return out


def _fetch_aligned_series(period: str = "1y") -> tuple[list[str], list[float], list[float], list[float | None]]:
    """Fetch XBI / TLT / VIX daily closes aligned on XBI's trading calendar."""
    import yfinance as yf

    def closes(symbol: str) -> dict[str, float]:
        hist = yf.Ticker(symbol).history(period=period, auto_adjust=True)
        if hist is None or hist.empty:
            return {}
        return {str(idx.date()): float(v) for idx, v in hist["Close"].dropna().items()}

    xbi = closes("XBI")
    tlt = closes("TLT")
    vix = closes("^VIX")
    dates = sorted(xbi)
    xbi_s = [xbi[d] for d in dates]
    tlt_s = [tlt.get(d, tlt[max(k for k in tlt if k <= d)] if any(k <= d for k in tlt) else 0.0) for d in dates]
    vix_s: list[float | None] = [vix.get(d) for d in dates]
    return dates, xbi_s, tlt_s, vix_s


def backfill(*, overwrite: bool = False, period: str = "1y") -> dict[str, Any]:
    """Fetch prices, classify each day, merge into ``regime_history.json``.

    Returns a summary dict with counts. Existing days are preserved unless
    ``overwrite`` is set.
    """
    from prediction.regime_calibration import load_regime_history, record_daily_regime

    dates, xbi_s, tlt_s, vix_s = _fetch_aligned_series(period=period)
    reconstructed = build_history_from_series(dates, xbi_s, tlt_s, vix_s)

    existing = load_regime_history()
    added = 0
    updated = 0
    for d, regime in sorted(reconstructed.items()):
        if d in existing and not overwrite:
            continue
        if d in existing:
            updated += 1
        else:
            added += 1
        record_daily_regime(d, regime)

    summary = {
        "reconstructed_days": len(reconstructed),
        "added": added,
        "updated": updated,
        "kept_existing": len(existing) if not overwrite else 0,
    }
    logger.info("[BackfillRegime] %s", summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Backfill regime_history.json from XBI/TLT/VIX prices")
    parser.add_argument("--overwrite", action="store_true", help="rebuild already-recorded days too")
    parser.add_argument("--period", default="1y", help="yfinance history window (default 1y)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO)
    summary = backfill(overwrite=args.overwrite, period=args.period)
    print(summary)
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())
