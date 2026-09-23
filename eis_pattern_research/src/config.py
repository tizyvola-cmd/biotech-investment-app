"""Central configuration for the EIS pattern research pipeline."""
from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
FIXTURES_DIR = PROJECT_ROOT / "fixtures" / "sample_raw"
REPORTS_DIR = PROJECT_ROOT / "reports"
NOTEBOOKS_DIR = PROJECT_ROOT / "notebooks"

DEFAULT_TICKERS = ("NRIX", "VRTX", "SRPT", "BIIB")
DEFAULT_BENCHMARK = "XBI"

# Event study
EVENT_WINDOW = (-20, 20)
PRE_EVENT_WINDOWS = (10, 20, 40)
CONTROL_HORIZON_DAYS = 20  # no EIS within this many days after control window

# Pattern / model
VOLUME_ZSCORE_SPIKE = 2.0
PREDICTION_HORIZON_DAYS = 10
MIN_EVENTS_FOR_SIGNIFICANCE = 8

# Schema — canonical long-format columns
CANONICAL_COLUMNS: tuple[str, ...] = (
    "ticker",
    "date",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "benchmark_close",
    "benchmark_volume",
    "eis_flag",
    "eis_score",
    "liquidity_current_ratio",
    "liquidity_quick_ratio",
    "liquidity_cash",
    "avg_dollar_volume_20d",
    "bid_ask_spread",
    "float_shares",
)
