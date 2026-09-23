"""Event study around EIS days — CAR, abnormal volume, significance tests."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

from .config import EVENT_WINDOW, MIN_EVENTS_FOR_SIGNIFICANCE, REPORTS_DIR

logger = logging.getLogger(__name__)


@dataclass
class EventStudyResult:
    car_by_day: pd.DataFrame
    abnormal_volume_by_day: pd.DataFrame
    pre_event_tests: pd.DataFrame
    post_event_tests: pd.DataFrame
    n_events: int
    significant: bool
    note: str


def _abnormal_return(row: pd.Series) -> float:
    tr = row.get("return_1d")
    br = np.log(row["benchmark_close"] / row["benchmark_close"]) if pd.isna(row.get("benchmark_close")) else None
    if tr is None or pd.isna(tr):
        return np.nan
    if row.get("benchmark_close") is not None and not pd.isna(row["benchmark_close"]):
        # use precomputed relative_strength_1d if available
        rs = row.get("relative_strength_1d")
        if rs is not None and not pd.isna(rs):
            return float(rs)
    return float(tr) if not pd.isna(tr) else np.nan


def run_event_study(df: pd.DataFrame) -> EventStudyResult:
    """
    Classic event study in [-20, +20] trading days around each EIS flag.
    Abnormal return = ticker log return - benchmark log return.
    """
    pre, post = EVENT_WINDOW
    offsets = list(range(pre, post + 1))
    car_rows: list[dict] = []
    vol_rows: list[dict] = []
    events_used = 0

    for ticker, g in df.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        g["abn_ret"] = g["relative_strength_1d"] if "relative_strength_1d" in g.columns else g["close"].pct_change()
        vol_mean = g["volume"].rolling(60, min_periods=20).mean()
        g["abn_vol"] = g["volume"] / vol_mean.replace(0, np.nan)

        eis_idx = g.index[g["eis_flag"].fillna(False)].tolist()
        for idx in eis_idx:
            if idx + post >= len(g) or idx + pre < 0:
                continue
            events_used += 1
            eis_score = g.loc[idx, "eis_score"]
            for off in offsets:
                j = idx + off
                car_rows.append(
                    {
                        "ticker": ticker,
                        "event_idx": idx,
                        "day_offset": off,
                        "abn_ret": g.loc[j, "abn_ret"],
                        "eis_score": eis_score,
                        "eis_sign": "positive" if (eis_score or 0) > 0 else "negative",
                    }
                )
                vol_rows.append(
                    {
                        "ticker": ticker,
                        "event_idx": idx,
                        "day_offset": off,
                        "abn_vol": g.loc[j, "abn_vol"],
                        "eis_sign": "positive" if (eis_score or 0) > 0 else "negative",
                    }
                )

    car_df = pd.DataFrame(car_rows)
    vol_df = pd.DataFrame(vol_rows)

    if car_df.empty:
        return EventStudyResult(
            car_by_day=pd.DataFrame(),
            abnormal_volume_by_day=pd.DataFrame(),
            pre_event_tests=pd.DataFrame(),
            post_event_tests=pd.DataFrame(),
            n_events=0,
            significant=False,
            note="No EIS events with sufficient window coverage.",
        )

    car_by_day = (
        car_df.groupby("day_offset", as_index=False)["abn_ret"]
        .agg(mean="mean", std="std", n="count")
        .sort_values("day_offset")
    )
    car_by_day["car"] = car_by_day["mean"].cumsum()

    vol_by_day = (
        vol_df.groupby("day_offset", as_index=False)["abn_vol"]
        .agg(mean="mean", std="std", n="count")
        .sort_values("day_offset")
    )

    pre_tests = _window_significance(car_df, range(pre, 0), "pre")
    post_tests = _window_significance(car_df, range(0, post + 1), "post")

    sig = events_used >= MIN_EVENTS_FOR_SIGNIFICANCE
    note = (
        f"Based on {events_used} events. "
        + (
            "Sample size below MIN_EVENTS_FOR_SIGNIFICANCE — treat as exploratory."
            if not sig
            else "Minimum event count reached — still validate on longer history."
        )
    )

    return EventStudyResult(
        car_by_day=car_by_day,
        abnormal_volume_by_day=vol_by_day,
        pre_event_tests=pre_tests,
        post_event_tests=post_tests,
        n_events=events_used,
        significant=sig,
        note=note,
    )


def _window_significance(car_df: pd.DataFrame, offsets: range, label: str) -> pd.DataFrame:
    sub = car_df[car_df["day_offset"].isin(offsets)]
    rows = []
    for sign in ("positive", "negative", "all"):
        s = sub if sign == "all" else sub[sub["eis_sign"] == sign]
        vals = s["abn_ret"].dropna().values
        if len(vals) < 3:
            rows.append({"window": label, "eis_sign": sign, "n": len(vals), "t_stat": np.nan, "p_value": np.nan})
            continue
        t_stat, p_val = stats.ttest_1samp(vals, 0.0, nan_policy="omit")
        rows.append(
            {
                "window": label,
                "eis_sign": sign,
                "n": len(vals),
                "mean_abn_ret": float(np.mean(vals)),
                "t_stat": float(t_stat),
                "p_value": float(p_val),
            }
        )
    return pd.DataFrame(rows)


def bootstrap_car_ci(
    car_df: pd.DataFrame,
    n_boot: int = 500,
    alpha: float = 0.05,
) -> pd.DataFrame:
    """Bootstrap CI for mean abnormal return by day offset."""
    rng = np.random.default_rng(1)
    offsets = sorted(car_df["day_offset"].unique())
    rows = []
    for off in offsets:
        vals = car_df.loc[car_df["day_offset"] == off, "abn_ret"].dropna().values
        if len(vals) < 3:
            continue
        boots = [np.mean(rng.choice(vals, size=len(vals), replace=True)) for _ in range(n_boot)]
        rows.append(
            {
                "day_offset": off,
                "mean": float(np.mean(vals)),
                "ci_low": float(np.quantile(boots, alpha / 2)),
                "ci_high": float(np.quantile(boots, 1 - alpha / 2)),
            }
        )
    return pd.DataFrame(rows)


def plot_car(result: EventStudyResult, output: Path | None = None) -> Path:
    output = output or REPORTS_DIR / "event_study_car.png"
    output.parent.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    car = result.car_by_day
    if not car.empty:
        axes[0].bar(car["day_offset"], car["mean"], color="steelblue", alpha=0.7, label="Mean AR")
        axes[0].plot(car["day_offset"], car["car"], color="darkred", marker="o", label="CAR")
        axes[0].axvline(0, color="black", linestyle="--", linewidth=0.8)
        axes[0].set_title(f"Cumulative Abnormal Return (n={result.n_events} events)")
        axes[0].set_xlabel("Days relative to EIS")
        axes[0].legend()

    vol = result.abnormal_volume_by_day
    if not vol.empty:
        axes[1].bar(vol["day_offset"], vol["mean"], color="darkorange", alpha=0.7)
        axes[1].axvline(0, color="black", linestyle="--", linewidth=0.8)
        axes[1].set_title("Abnormal volume (vs 60d mean)")
        axes[1].set_xlabel("Days relative to EIS")

    fig.tight_layout()
    fig.savefig(output, dpi=120)
    plt.close(fig)
    return output
