"""
Generate coherent synthetic daily panels for pipeline verification.

~130 trading days, 4 tickers + XBI benchmark, quarterly liquidity, sparse EIS events.
NOT intended as realistic market data — only schema/pipeline smoke test.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import DEFAULT_BENCHMARK, DEFAULT_TICKERS, FIXTURES_DIR, RAW_DIR

RNG = np.random.default_rng(42)

TICKER_PROFILES: dict[str, dict] = {
    "NRIX": {"start": 12.0, "vol": 0.028, "float_m": 45, "cr": 3.2, "qr": 2.8, "cash_m": 180},
    "VRTX": {"start": 420.0, "vol": 0.018, "float_m": 250, "cr": 2.1, "qr": 1.9, "cash_m": 4200},
    "SRPT": {"start": 145.0, "vol": 0.035, "float_m": 90, "cr": 1.8, "qr": 1.6, "cash_m": 890},
    "BIIB": {"start": 210.0, "vol": 0.022, "float_m": 145, "cr": 2.4, "qr": 2.1, "cash_m": 3100},
}


def _business_days(n: int, end: str = "2026-08-28") -> pd.DatetimeIndex:
    end_dt = pd.Timestamp(end)
    return pd.bdate_range(end=end_dt, periods=n)


def _simulate_ohlcv(
    dates: pd.DatetimeIndex,
    *,
    start_price: float,
    daily_vol: float,
    base_volume: int,
    pre_spike_days: set[int] | None = None,
) -> pd.DataFrame:
    n = len(dates)
    rets = RNG.normal(0, daily_vol, n)
    if pre_spike_days:
        for d in pre_spike_days:
            if 0 <= d < n:
                rets[d] += RNG.uniform(0.002, 0.008)

    log_close = np.log(start_price) + np.cumsum(rets)
    close = np.exp(log_close)
    open_ = close * (1 + RNG.normal(0, 0.003, n))
    high = np.maximum(open_, close) * (1 + RNG.uniform(0, 0.012, n))
    low = np.minimum(open_, close) * (1 - RNG.uniform(0, 0.012, n))

    vol = base_volume * (1 + RNG.normal(0, 0.25, n))
    vol = np.clip(vol, base_volume * 0.3, None).astype(int)
    if pre_spike_days:
        for d in pre_spike_days:
            if 0 <= d < n - 1:
                vol[d - 1] = int(vol[d - 1] * RNG.uniform(1.4, 2.2))
                vol[d] = int(vol[d] * RNG.uniform(2.5, 4.0))

    return pd.DataFrame(
        {
            "date": dates,
            "open": np.round(open_, 4),
            "high": np.round(high, 4),
            "low": np.round(low, 4),
            "close": np.round(close, 4),
            "volume": vol,
        }
    )


def _quarterly_liquidity(dates: pd.DatetimeIndex, profile: dict) -> pd.DataFrame:
    q_dates = pd.date_range(dates.min(), dates.max(), freq="QS")
    rows = []
    cr = profile["cr"]
    qr = profile["qr"]
    cash = profile["cash_m"]
    for i, q in enumerate(q_dates):
        drift = 1 + RNG.normal(0, 0.04)
        rows.append(
            {
                "quarter_start": q,
                "liquidity_current_ratio": round(cr * drift, 2),
                "liquidity_quick_ratio": round(qr * drift, 2),
                "liquidity_cash": round(cash * (1 + RNG.normal(0, 0.06)) * 1_000_000, 0),
            }
        )
    liq = pd.DataFrame(rows)
    daily = pd.DataFrame({"date": dates})
    daily = daily.merge(liq, how="cross")
    daily = daily[daily["date"] >= daily["quarter_start"]]
    daily = daily.sort_values("date").groupby("date", as_index=False).last()
    daily = daily.drop(columns=["quarter_start"])
    daily = daily.set_index("date").reindex(dates)
    daily.index.name = "date"
    daily = daily.ffill().reset_index()
    return daily


def _inject_eis_events(
    df: pd.DataFrame,
    *,
    n_events: int = 3,
    pre_accumulation: bool = True,
) -> tuple[pd.DataFrame, set[int]]:
    n = len(df)
    # Avoid edges — need pre/post window room
    candidates = list(range(30, n - 25))
    event_idx = sorted(RNG.choice(candidates, size=min(n_events, len(candidates)), replace=False))
    pre_days: set[int] = set()
    for idx in event_idx:
        score = float(RNG.choice([-2.5, -1.2, 0.8, 2.0, 3.5]))
        df.loc[df.index[idx], "eis_flag"] = True
        df.loc[df.index[idx], "eis_score"] = score
        if pre_accumulation:
            for d in range(max(0, idx - 5), idx):
                pre_days.add(d)
    return df, pre_days


def build_ticker_panel(ticker: str, dates: pd.DatetimeIndex) -> pd.DataFrame:
    profile = TICKER_PROFILES[ticker]
    base_vol = int(RNG.integers(400_000, 1_200_000))
    df = _simulate_ohlcv(
        dates,
        start_price=profile["start"],
        daily_vol=profile["vol"],
        base_volume=base_vol,
    )
    df["ticker"] = ticker
    df["eis_flag"] = False
    df["eis_score"] = np.nan

    df, pre_days = _inject_eis_events(df, n_events=RNG.integers(2, 5))
    # Re-simulate volume bumps for pre-event archetype (second pass on volume only)
    for d in pre_days:
        if 0 <= d < len(df):
            df.loc[df.index[d], "volume"] = int(df.loc[df.index[d], "volume"] * RNG.uniform(1.3, 1.9))

    liq = _quarterly_liquidity(dates, profile)
    df = df.merge(liq, on="date", how="left")

    df["float_shares"] = profile["float_m"] * 1_000_000
    df["avg_dollar_volume_20d"] = (df["close"] * df["volume"]).rolling(20, min_periods=5).mean()
    df["bid_ask_spread"] = np.nan  # not available in sample
    return df


def build_benchmark_panel(dates: pd.DatetimeIndex) -> pd.DataFrame:
    df = _simulate_ohlcv(dates, start_price=88.0, daily_vol=0.015, base_volume=5_000_000)
    df["ticker"] = DEFAULT_BENCHMARK
    return df


def generate_sample_panels(n_days: int = 130) -> dict[str, pd.DataFrame]:
    dates = _business_days(n_days)
    panels = {tk: build_ticker_panel(tk, dates) for tk in DEFAULT_TICKERS}
    panels[DEFAULT_BENCHMARK] = build_benchmark_panel(dates)
    return panels


def write_sample_csvs(directory: Path | None = None) -> Path:
    directory = directory or FIXTURES_DIR
    directory.mkdir(parents=True, exist_ok=True)
    panels = generate_sample_panels()
    for ticker, df in panels.items():
        out = df.copy()
        path = directory / f"{ticker}.csv"
        out.to_csv(path, index=False)
    return directory


def ensure_sample_raw_csvs() -> Path:
    """Write fixtures if missing; also copy to data/raw for editable runs."""
    if not any(FIXTURES_DIR.glob("*.csv")):
        write_sample_csvs(FIXTURES_DIR)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for src in FIXTURES_DIR.glob("*.csv"):
        dst = RAW_DIR / src.name
        if not dst.exists():
            dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return FIXTURES_DIR


if __name__ == "__main__":
    path = write_sample_csvs()
    print(f"Sample CSVs written to {path}")
