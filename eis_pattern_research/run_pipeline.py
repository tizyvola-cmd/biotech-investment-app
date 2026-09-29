#!/usr/bin/env python3
"""
End-to-end pipeline: ingestion → features → event study → pattern mining → model → report.

Usage:
  python run_pipeline.py
  python run_pipeline.py --fixtures   # force sample data
  python run_pipeline.py --tickers NRIX VRTX
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running as script from project root
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import DEFAULT_TICKERS, PROCESSED_DIR, REPORTS_DIR
from src.eventstudy import plot_car, run_event_study
from src.features import engineer_features
from src.ingestion import load_from_project, save_processed
from src.model import walk_forward_logistic
from src.patterns import plot_feature_comparison, run_pattern_mining
from src.scanner import scan_universe

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pipeline")


def write_report(
    *,
    n_rows: int,
    n_tickers: int,
    event_result,
    pattern_result,
    model_result,
    scanner_df,
) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / "pattern_report.md"
    lines = [
        "# EIS / Price / Volume / Liquidity — Pattern Report",
        "",
        f"_Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_",
        "",
        "## Data summary",
        f"- Panel rows: **{n_rows}**",
        f"- Tickers: **{n_tickers}**",
        "",
        "> **Disclaimer:** Patterns on 4–6 months and a handful of tickers are **hypotheses**,",
        "> not validated signals. Past correlation does not guarantee future results.",
        "> This is a research tool, not investment advice.",
        "",
        "## Event study (EIS window)",
        f"- Events analyzed: **{event_result.n_events}**",
        f"- Statistically trustworthy (n≥8): **{event_result.significant}**",
        f"- Note: {event_result.note}",
        "",
    ]

    if not event_result.pre_event_tests.empty:
        lines.append("### Pre-event abnormal return tests")
        lines.append("")
        lines.append(event_result.pre_event_tests.to_markdown(index=False))
        lines.append("")

    if not event_result.post_event_tests.empty:
        lines.append("### Post-event abnormal return tests")
        lines.append("")
        lines.append(event_result.post_event_tests.to_markdown(index=False))
        lines.append("")

    lines.extend(
        [
            "## Pre-event pattern mining",
            f"- Pre-event windows: **{pattern_result.n_pre_events}**",
            f"- Control windows: **{pattern_result.n_controls}**",
            f"- Trustworthy: **{pattern_result.trustworthy}**",
            "",
        ]
    )
    for w in pattern_result.warnings:
        lines.append(f"- ⚠ {w}")
    lines.append("")

    if not pattern_result.comparisons.empty:
        lines.append("### Feature comparison (Mann-Whitney U)")
        lines.append("")
        lines.append(pattern_result.comparisons.head(10).to_markdown(index=False))
        lines.append("")

    if not pattern_result.feature_importance.empty:
        lines.append("### Feature importance (random forest)")
        lines.append("")
        lines.append(pattern_result.feature_importance.head(10).to_markdown(index=False))
        lines.append("")

    if not pattern_result.cluster_labels.empty and "cluster" in pattern_result.cluster_labels.columns:
        counts = pattern_result.cluster_labels["cluster"].value_counts().sort_index()
        lines.append("### Pre-event archetype clusters")
        lines.append("")
        for c, n in counts.items():
            lines.append(f"- Cluster {c}: {n} events")
        lines.append("")

    lines.extend(
        [
            "## Predictive model (walk-forward logistic)",
            f"- Test-set positive labels: **{model_result.n_test_events}**",
            f"- Trustworthy: **{model_result.trustworthy}**",
            f"- Note: {model_result.note}",
            "",
        ]
    )
    if model_result.aggregate:
        lines.append("### Aggregate metrics")
        lines.append("")
        for k, v in model_result.aggregate.items():
            lines.append(f"- **{k}**: {v}")
        lines.append("")

    lines.append("### Random baseline (same signal frequency)")
    lines.append("")
    for k, v in model_result.random_baseline.items():
        lines.append(f"- **{k}**: {v}")
    lines.append("")

    if not model_result.backtest.empty:
        mean_bt = model_result.backtest["fwd_return_5d"].mean()
        lines.append(f"- Strategy mean 5d forward return: **{mean_bt:.4f}** (historical simulation)")
        lines.append("")

    lines.extend(
        [
            "## Scanner (latest day similarity to pre-event archetypes)",
            "",
        ]
    )
    if scanner_df is not None and not scanner_df.empty:
        lines.append(scanner_df.to_markdown(index=False))
    else:
        lines.append("_No scanner output._")
    lines.append("")

    lines.extend(
        [
            "## Charts",
            "- `reports/event_study_car.png`",
            "- `reports/pre_event_feature_comparison.png`",
            "",
            "## Next steps",
            "1. Export real OHLCV + EIS from SuperNova (see `SupernovaEisStubLoader` in `src/ingestion.py`).",
            "2. Extend to 20+ tickers and 2–3 years of history.",
            "3. Re-run pipeline; ignore patterns that do not survive larger sample.",
        ]
    )

    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="EIS pattern research pipeline")
    parser.add_argument("--fixtures", action="store_true", help="Use/generate sample fixtures")
    parser.add_argument("--tickers", nargs="*", default=list(DEFAULT_TICKERS))
    args = parser.parse_args()

    logger.info("Loading data...")
    panel = load_from_project(use_fixtures=args.fixtures, tickers=args.tickers)
    # Drop benchmark ticker from equity panel
    panel = panel[panel["ticker"] != "XBI"].copy()
    logger.info("Loaded %d rows, tickers: %s", len(panel), sorted(panel["ticker"].unique()))

    logger.info("Feature engineering...")
    featured = engineer_features(panel)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    save_processed(featured, PROCESSED_DIR / "daily_features.parquet")

    logger.info("Event study...")
    event_result = run_event_study(featured)
    plot_car(event_result)

    logger.info("Pattern mining...")
    pattern_result = run_pattern_mining(featured, window=20)
    plot_feature_comparison(pattern_result)

    logger.info("Walk-forward model...")
    model_result = walk_forward_logistic(featured)

    logger.info("Scanner...")
    scanner_df = scan_universe(featured, list(args.tickers), pattern_result)

    report_path = write_report(
        n_rows=len(featured),
        n_tickers=featured["ticker"].nunique(),
        event_result=event_result,
        pattern_result=pattern_result,
        model_result=model_result,
        scanner_df=scanner_df,
    )
    logger.info("Report written: %s", report_path)
    print(f"\nDone. Open {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
