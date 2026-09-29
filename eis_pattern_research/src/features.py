"""Feature engineering on the canonical daily panel."""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .config import PRE_EVENT_WINDOWS

logger = logging.getLogger(__name__)


def _log_return(series: pd.Series) -> pd.Series:
    return np.log(series / series.shift(1))


def _zscore(series: pd.Series, window: int) -> pd.Series:
    mu = series.rolling(window, min_periods=max(5, window // 4)).mean()
    sd = series.rolling(window, min_periods=max(5, window // 4)).std()
    return (series - mu) / sd.replace(0, np.nan)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add return, volume, volatility, relative strength, liquidity features per ticker."""
    frames: list[pd.DataFrame] = []
    for ticker, g in df.groupby("ticker", sort=False):
        x = g.sort_values("date").copy()
        x["return_1d"] = _log_return(x["close"])
        x["return_5d"] = x["close"].pct_change(5)
        x["return_20d"] = x["close"].pct_change(20)

        x["volume_zscore_20d"] = _zscore(x["volume"].astype(float), 20)
        x["volume_zscore_60d"] = _zscore(x["volume"].astype(float), 60)
        x["volatility_20d"] = x["return_1d"].rolling(20, min_periods=10).std()

        bench_ret_1 = _log_return(x["benchmark_close"]) if x["benchmark_close"].notna().any() else pd.Series(np.nan, index=x.index)
        x["relative_strength_1d"] = x["return_1d"] - bench_ret_1
        x["relative_strength_5d"] = x["return_5d"] - x["benchmark_close"].pct_change(5)
        x["relative_strength_20d"] = x["return_20d"] - x["benchmark_close"].pct_change(20)

        # Rolling beta 60d
        if x["benchmark_close"].notna().sum() >= 30:
            bench_ret = _log_return(x["benchmark_close"])
            cov = x["return_1d"].rolling(60, min_periods=30).cov(bench_ret)
            var = bench_ret.rolling(60, min_periods=30).var()
            x["rolling_beta_60d"] = cov / var.replace(0, np.nan)
        else:
            x["rolling_beta_60d"] = np.nan
            logger.warning("%s: insufficient benchmark data for beta", ticker)

        # Days since last EIS (causal — only past events)
        eis_dates = x.loc[x["eis_flag"].fillna(False), "date"]
        if len(eis_dates):
            x["days_since_last_eis"] = x["date"].apply(
                lambda d: (d - eis_dates[eis_dates <= d].max()).days if (eis_dates <= d).any() else np.nan
            )
        else:
            x["days_since_last_eis"] = np.nan

        # days_to_next_eis — EVENT STUDY ONLY (not for predictive model)
        if len(eis_dates):
            x["days_to_next_eis"] = x["date"].apply(
                lambda d: (eis_dates[eis_dates >= d].min() - d).days if (eis_dates >= d).any() else np.nan
            )
        else:
            x["days_to_next_eis"] = np.nan

        # Liquidity trend (quarter-over-quarter pct change, forward-filled)
        for col in ("liquidity_current_ratio", "liquidity_quick_ratio", "liquidity_cash"):
            if col in x.columns:
                x[f"{col}_qoq_pct"] = x[col].pct_change(63)  # ~1 quarter trading days

        x["turnover_ratio"] = x["volume"] / x["float_shares"].replace(0, np.nan)
        if x["avg_dollar_volume_20d"].isna().all():
            x["avg_dollar_volume_20d"] = (x["close"] * x["volume"]).rolling(20, min_periods=5).mean()

        frames.append(x)

    out = pd.concat(frames, ignore_index=True)
    return out.sort_values(["ticker", "date"]).reset_index(drop=True)


def extract_pre_event_windows(
    df: pd.DataFrame,
    window: int = 20,
) -> pd.DataFrame:
    """
    For each EIS event, extract the `window` trading days BEFORE the event.
    Returns long format: event_id, ticker, event_date, day_offset (negative), features...
    """
    feature_cols = [
        "return_1d",
        "volume_zscore_20d",
        "volume_zscore_60d",
        "volatility_20d",
        "relative_strength_5d",
        "relative_strength_20d",
        "rolling_beta_60d",
        "liquidity_current_ratio_qoq_pct",
        "turnover_ratio",
    ]
    rows: list[dict] = []
    event_id = 0
    for ticker, g in df.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        eis_idx = g.index[g["eis_flag"].fillna(False)].tolist()
        for idx in eis_idx:
            start = max(0, idx - window)
            if idx - start < window // 2:
                continue
            event_id += 1
            for j in range(start, idx):
                row = {
                    "event_id": event_id,
                    "ticker": ticker,
                    "event_date": g.loc[idx, "date"],
                    "day_offset": j - idx,
                }
                for col in feature_cols:
                    row[col] = g.loc[j, col] if col in g.columns else np.nan
                rows.append(row)
    return pd.DataFrame(rows)


def build_control_windows(
    df: pd.DataFrame,
    window: int = 20,
    horizon: int = 20,
) -> pd.DataFrame:
    """
    Random control windows: same length, no EIS within `horizon` days after window end.
    """
    feature_cols = [
        "return_1d",
        "volume_zscore_20d",
        "volume_zscore_60d",
        "volatility_20d",
        "relative_strength_5d",
        "relative_strength_20d",
        "rolling_beta_60d",
        "liquidity_current_ratio_qoq_pct",
        "turnover_ratio",
    ]
    rng = np.random.default_rng(0)
    rows: list[dict] = []
    ctrl_id = 0
    for ticker, g in df.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        n = len(g)
        eis_set = set(g.index[g["eis_flag"].fillna(False)].tolist())
        attempts = 0
        max_controls = 5
        while len([r for r in rows if r["ticker"] == ticker]) < max_controls and attempts < 50:
            attempts += 1
            end = int(rng.integers(window, n - horizon))
            start = end - window
            future = set(range(end, min(n, end + horizon)))
            if eis_set & future:
                continue
            if eis_set & set(range(start, end)):
                continue
            ctrl_id += 1
            for j in range(start, end):
                row = {
                    "control_id": ctrl_id,
                    "ticker": ticker,
                    "window_end": g.loc[end - 1, "date"],
                    "day_offset": j - end,
                }
                for col in feature_cols:
                    row[col] = g.loc[j, col] if col in g.columns else np.nan
                rows.append(row)
    return pd.DataFrame(rows)


def aggregate_window_features(windows: pd.DataFrame, id_col: str) -> pd.DataFrame:
    """Collapse each window to one row (mean of features)."""
    if windows.empty:
        return windows
    feature_cols = [c for c in windows.columns if c not in (id_col, "ticker", "event_date", "window_end", "day_offset")]
    return windows.groupby([id_col, "ticker"], as_index=False)[feature_cols].mean(numeric_only=True)
