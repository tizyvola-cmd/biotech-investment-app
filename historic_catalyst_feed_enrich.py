#!/usr/bin/env python3
"""
Backfill Catalyst Feed (clinical_pre_cd_enrichment_snapshot.json) for historical
past_catalyst_predictions rows, then refresh EIS metadata on past_pred + optional
signal_calibration.json curve impact chart.

Lite default (fast): CT.gov structured events + KPI EIS, no AI / yfinance / press.
"""
from __future__ import annotations

import argparse
import json
import sys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Historic Catalyst Feed enrich for past_catalyst_predictions (EIS backfill)",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Max studies to process (0 = all with nct + chart pairs)",
    )
    ap.add_argument("--force", action="store_true", help="Re-enrich even if snapshot row exists")
    ap.add_argument(
        "--with-yfinance",
        action="store_true",
        help="Fetch market prices for EIS (much slower; default skips yfinance)",
    )
    ap.add_argument(
        "--with-ai",
        action="store_true",
        help="Run Copilot AI synthesis (slow; default uses CT.gov structured only)",
    )
    ap.add_argument(
        "--with-press",
        action="store_true",
        help="Fetch press releases (slow; default skips)",
    )
    ap.add_argument(
        "--all-past-rows",
        action="store_true",
        help="Include rows without close_m5/close_m60 (not used in curve chart)",
    )
    ap.add_argument(
        "--rebuild-calibration",
        action="store_true",
        help="Regenerate data/signal_calibration.json after enrich",
    )
    ap.add_argument(
        "--no-past-pred-refresh",
        action="store_true",
        help="Skip past_pred display metadata refresh",
    )
    ap.add_argument(
        "--persist-every",
        type=int,
        default=25,
        help="Write snapshot every N enriched rows (default 25)",
    )
    args = ap.parse_args(argv)

    from clinical_pre_cd_enrichment import run_historic_past_catalyst_feed_enrichment

    limit = int(args.limit) if args.limit and args.limit > 0 else None
    print(
        f"[HistoricFeed] start limit={limit or 'ALL'} "
        f"yfinance={args.with_yfinance} ai={args.with_ai}",
        flush=True,
    )
    result = run_historic_past_catalyst_feed_enrichment(
        limit=limit,
        force=bool(args.force),
        skip_ai=not args.with_ai,
        skip_yfinance=not args.with_yfinance,
        skip_press=not args.with_press,
        require_chart_pairs=not args.all_past_rows,
        persist_every=max(1, int(args.persist_every)),
        rebuild_past_pred=not args.no_past_pred_refresh,
        rebuild_signal_calibration=bool(args.rebuild_calibration),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    if result.get("error") and not result.get("enriched"):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
