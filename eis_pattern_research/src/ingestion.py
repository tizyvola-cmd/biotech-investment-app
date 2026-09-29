"""
Pluggable data ingestion — normalize heterogeneous sources into one long-format schema.

Supported loaders:
  - CsvDirectoryLoader   : one CSV per ticker in a folder
  - ParquetLoader        : single parquet with ticker column
  - ManualFrameLoader    : pass a pre-built DataFrame
  - SupernovaEisStubLoader : placeholder for future SuperNova clinical feed export

Missing columns are left as NaN with an explicit warning — never invented.
"""
from __future__ import annotations

import logging
import warnings
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import CANONICAL_COLUMNS, DEFAULT_BENCHMARK

logger = logging.getLogger(__name__)

# Aliases from common export column names → canonical
_COLUMN_ALIASES: dict[str, str] = {
    "ticker": "ticker",
    "symbol": "ticker",
    "date": "date",
    "datetime": "date",
    "timestamp": "date",
    "open": "open",
    "high": "high",
    "low": "low",
    "close": "close",
    "adj_close": "close",
    "adjusted_close": "close",
    "volume": "volume",
    "vol": "volume",
    "benchmark_close": "benchmark_close",
    "xbi_close": "benchmark_close",
    "benchmark_volume": "benchmark_volume",
    "xbi_volume": "benchmark_volume",
    "eis_flag": "eis_flag",
    "eis": "eis_flag",
    "eis_score": "eis_score",
    "eis impact": "eis_score",
    "impact_score": "eis_score",
    "current_ratio": "liquidity_current_ratio",
    "liquidity_current_ratio": "liquidity_current_ratio",
    "quick_ratio": "liquidity_quick_ratio",
    "liquidity_quick_ratio": "liquidity_quick_ratio",
    "cash": "liquidity_cash",
    "liquidity_cash": "liquidity_cash",
    "avg_dollar_volume_20d": "avg_dollar_volume_20d",
    "dollar_volume_20d": "avg_dollar_volume_20d",
    "bid_ask_spread": "bid_ask_spread",
    "spread": "bid_ask_spread",
    "float_shares": "float_shares",
    "float": "float_shares",
}


def _normalize_column_names(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    rename: dict[str, str] = {}
    for col in out.columns:
        key = str(col).strip().lower().replace(" ", "_")
        if key in _COLUMN_ALIASES:
            rename[col] = _COLUMN_ALIASES[key]
    return out.rename(columns=rename)


def _parse_dates(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, utc=False, errors="coerce").dt.normalize()


def _coerce_bool(series: pd.Series) -> pd.Series:
    if series.dtype == bool:
        return series
    mapping = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}
    return series.map(lambda x: mapping.get(str(x).strip().lower(), x)).astype("boolean")


def align_trading_calendar(
    df: pd.DataFrame,
    *,
    drop_non_trading: bool = True,
) -> pd.DataFrame:
    """
    Align each ticker to a business-day index (Mon–Fri).
    Missing market days become NaN rows (explicit gaps, not silent forward-fill of OHLC).
    """
    if df.empty:
        return df

    frames: list[pd.DataFrame] = []
    for ticker, grp in df.groupby("ticker", sort=False):
        g = grp.sort_values("date").drop_duplicates(subset=["date"], keep="last")
        if g.empty:
            continue
        idx = pd.bdate_range(g["date"].min(), g["date"].max())
        g = g.set_index("date").reindex(idx)
        g.index.name = "date"
        g["ticker"] = ticker
        if drop_non_trading:
            # Rows that were never observed (weekends already excluded by bdate_range)
            pass
        g = g.reset_index()
        frames.append(g)

    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["ticker", "date"]).reset_index(drop=True)


def validate_and_warn(df: pd.DataFrame, source: str) -> pd.DataFrame:
    """Ensure schema, log warnings for missing optional columns."""
    out = _normalize_column_names(df)
    if "date" not in out.columns:
        raise ValueError(f"{source}: missing required column 'date'")
    if "ticker" not in out.columns:
        raise ValueError(f"{source}: missing required column 'ticker'")

    out["date"] = _parse_dates(out["date"])
    out["ticker"] = out["ticker"].astype(str).str.strip().str.upper()

    required_price = ("open", "high", "low", "close", "volume")
    for col in required_price:
        if col not in out.columns:
            warnings.warn(f"{source}: missing OHLCV column '{col}' — left as NaN", stacklevel=2)
            out[col] = np.nan

    optional = [c for c in CANONICAL_COLUMNS if c not in ("ticker", "date")]
    for col in optional:
        if col not in out.columns:
            logger.warning("%s: optional column '%s' not available — NaN", source, col)
            out[col] = np.nan

    if "eis_flag" in out.columns:
        out["eis_flag"] = _coerce_bool(out["eis_flag"]).fillna(False)
    else:
        out["eis_flag"] = False

    numeric_cols = [
        c
        for c in CANONICAL_COLUMNS
        if c not in ("ticker", "date", "eis_flag")
    ]
    for col in numeric_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    out = out[list(CANONICAL_COLUMNS)]
    out = out.dropna(subset=["date"])
    return out


class DataLoader(ABC):
    """Pluggable ingestion source."""

    @abstractmethod
    def load(self) -> pd.DataFrame:
        ...


class CsvDirectoryLoader(DataLoader):
    """Load `{ticker}.csv` or `{ticker}_daily.csv` files from a directory."""

    def __init__(self, directory: Path | str, tickers: Sequence[str] | None = None):
        self.directory = Path(directory)
        self.tickers = [t.upper() for t in tickers] if tickers else None

    def _resolve_file(self, ticker: str) -> Path | None:
        for name in (f"{ticker}.csv", f"{ticker}_daily.csv", f"{ticker.lower()}.csv"):
            p = self.directory / name
            if p.is_file():
                return p
        return None

    def load(self) -> pd.DataFrame:
        if not self.directory.is_dir():
            raise FileNotFoundError(f"CSV directory not found: {self.directory}")

        tickers = self.tickers
        if tickers is None:
            tickers = sorted(
                {p.stem.replace("_daily", "").upper() for p in self.directory.glob("*.csv")}
            )

        frames: list[pd.DataFrame] = []
        for tk in tickers:
            path = self._resolve_file(tk)
            if path is None:
                logger.warning("No CSV for ticker %s in %s", tk, self.directory)
                continue
            raw = pd.read_csv(path)
            if "ticker" not in raw.columns:
                raw["ticker"] = tk
            frames.append(validate_and_warn(raw, str(path)))

        if not frames:
            raise FileNotFoundError(f"No ticker CSVs loaded from {self.directory}")

        df = pd.concat(frames, ignore_index=True)
        return align_trading_calendar(df)


class ParquetLoader(DataLoader):
    def __init__(self, path: Path | str):
        self.path = Path(path)

    def load(self) -> pd.DataFrame:
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        raw = pd.read_parquet(self.path)
        df = validate_and_warn(raw, str(self.path))
        return align_trading_calendar(df)


class ManualFrameLoader(DataLoader):
    def __init__(self, frame: pd.DataFrame, source: str = "manual"):
        self.frame = frame
        self.source = source

    def load(self) -> pd.DataFrame:
        df = validate_and_warn(self.frame, self.source)
        return align_trading_calendar(df)


class BenchmarkCsvLoader(DataLoader):
    """Load benchmark (e.g. XBI) OHLCV and merge onto ticker rows by date."""

    def __init__(self, benchmark_path: Path | str, ticker_df: pd.DataFrame):
        self.benchmark_path = Path(benchmark_path)
        self.ticker_df = ticker_df

    def load(self) -> pd.DataFrame:
        raw = pd.read_csv(self.benchmark_path)
        raw = _normalize_column_names(raw)
        if "date" not in raw.columns:
            raise ValueError(f"Benchmark file missing date: {self.benchmark_path}")
        raw["date"] = _parse_dates(raw["date"])
        if "close" not in raw.columns:
            raise ValueError(f"Benchmark file missing close: {self.benchmark_path}")
        bench = raw[["date", "close"]].copy()
        bench = bench.rename(columns={"close": "benchmark_close"})
        if "volume" in raw.columns:
            bench["benchmark_volume"] = pd.to_numeric(raw["volume"], errors="coerce")
        else:
            bench["benchmark_volume"] = np.nan

        out = self.ticker_df.drop(columns=["benchmark_close", "benchmark_volume"], errors="ignore")
        out = out.merge(bench, on="date", how="left")
        missing = out["benchmark_close"].isna().mean()
        if missing > 0.05:
            logger.warning(
                "Benchmark merge: %.1f%% of rows missing benchmark_close",
                missing * 100,
            )
        return out


class SupernovaEisStubLoader(DataLoader):
    """
    Placeholder for SuperNova clinical/EIS feed export.

    Expected future interface:
      - JSON/CSV with columns: ticker, event_date, eis_score, source, nct_id
    Implement `load()` when the export API is available.
    """

    def __init__(self, export_path: Path | str | None = None):
        self.export_path = Path(export_path) if export_path else None

    def load(self) -> pd.DataFrame:
        if self.export_path is None or not self.export_path.is_file():
            raise NotImplementedError(
                "SupernovaEisStubLoader: connect a real EIS export path. "
                "Expected schema: ticker, date, eis_score."
            )
        events = pd.read_csv(self.export_path)
        events = validate_and_warn(events, str(self.export_path))
        events["eis_flag"] = True
        return events


def merge_eis_events(
    daily: pd.DataFrame,
    events: pd.DataFrame,
    *,
    score_col: str = "eis_score",
) -> pd.DataFrame:
    """Merge EIS event rows onto daily panel (same ticker+date)."""
    out = daily.copy()
    ev = events[["ticker", "date", score_col]].copy()
    ev = ev.rename(columns={score_col: "eis_score"})
    ev["eis_flag"] = True
    out = out.merge(ev, on=["ticker", "date"], how="left", suffixes=("_old", ""))
    if "eis_score_old" in out.columns:
        out["eis_score"] = out["eis_score"].fillna(out["eis_score_old"])
        out = out.drop(columns=["eis_score_old"])
    out["eis_flag"] = out["eis_flag"].fillna(False)
    if "eis_flag_old" in out.columns:
        out["eis_flag"] = out["eis_flag"] | out["eis_flag_old"].fillna(False)
        out = out.drop(columns=["eis_flag_old"])
    return out


def load_universe(
    loaders: Iterable[DataLoader],
    *,
    align_calendar: bool = True,
) -> pd.DataFrame:
    """Run one or more loaders and concatenate (dedupe ticker+date)."""
    frames = [loader.load() for loader in loaders]
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset=["ticker", "date"], keep="last")
    df = df.sort_values(["ticker", "date"]).reset_index(drop=True)
    if align_calendar:
        df = align_trading_calendar(df)
    return df


def save_processed(df: pd.DataFrame, path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".parquet":
        df.to_parquet(path, index=False)
    else:
        df.to_csv(path, index=False)
    logger.info("Saved processed panel: %s (%d rows)", path, len(df))


def load_from_project(
    *,
    use_fixtures: bool = False,
    tickers: Sequence[str] | None = None,
) -> pd.DataFrame:
    """
    Convenience entry: load sample fixtures or data/raw CSVs.
    Generates fixtures on first run if missing.
    """
    from .sample_data import ensure_sample_raw_csvs
    from .config import DEFAULT_BENCHMARK, FIXTURES_DIR, RAW_DIR, DEFAULT_TICKERS

    if use_fixtures or not any(RAW_DIR.glob("*.csv")):
        ensure_sample_raw_csvs()
        directory = FIXTURES_DIR
    else:
        directory = RAW_DIR

    tickers = [t for t in (tickers or DEFAULT_TICKERS) if t.upper() != DEFAULT_BENCHMARK]
    loader = CsvDirectoryLoader(directory, tickers=tickers)
    df = loader.load()

    bench_path = directory / f"{DEFAULT_BENCHMARK}.csv"
    if bench_path.is_file():
        df = BenchmarkCsvLoader(bench_path, df).load()

    return df
