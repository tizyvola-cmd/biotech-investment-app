"""Pre-event pattern mining — compare EIS windows vs control, clustering, feature importance."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

from .config import MIN_EVENTS_FOR_SIGNIFICANCE, PRE_EVENT_WINDOWS, REPORTS_DIR
from .features import (
    aggregate_window_features,
    build_control_windows,
    extract_pre_event_windows,
)

logger = logging.getLogger(__name__)


@dataclass
class PatternMiningResult:
    comparisons: pd.DataFrame
    cluster_labels: pd.DataFrame
    feature_importance: pd.DataFrame
    n_pre_events: int
    n_controls: int
    trustworthy: bool
    warnings: list[str]


def compare_pre_event_vs_control(
    pre_windows: pd.DataFrame,
    ctrl_windows: pd.DataFrame,
    id_col_pre: str = "event_id",
    id_col_ctrl: str = "control_id",
) -> pd.DataFrame:
    """Mann-Whitney U test per feature: pre-event aggregated windows vs controls."""
    pre_agg = aggregate_window_features(pre_windows, id_col_pre)
    ctrl_agg = aggregate_window_features(ctrl_windows, id_col_ctrl)
    if pre_agg.empty or ctrl_agg.empty:
        return pd.DataFrame()

    feature_cols = [c for c in pre_agg.columns if c not in (id_col_pre, "ticker")]
    rows = []
    for col in feature_cols:
        a = pre_agg[col].dropna().values
        b = ctrl_agg[col].dropna().values
        if len(a) < 2 or len(b) < 2:
            rows.append({"feature": col, "n_pre": len(a), "n_ctrl": len(b), "p_value": np.nan})
            continue
        stat, p = stats.mannwhitneyu(a, b, alternative="two-sided")
        rows.append(
            {
                "feature": col,
                "n_pre": len(a),
                "n_ctrl": len(b),
                "pre_mean": float(np.mean(a)),
                "ctrl_mean": float(np.mean(b)),
                "u_stat": float(stat),
                "p_value": float(p),
            }
        )
    out = pd.DataFrame(rows).sort_values("p_value")
    out["significant_05"] = out["p_value"] < 0.05
    return out


def cluster_pre_event_archetypes(
    pre_windows: pd.DataFrame,
    window: int = 20,
    n_clusters: int = 3,
) -> pd.DataFrame:
    """K-means on flattened pre-event feature trajectories (one row per event)."""
    if pre_windows.empty:
        return pd.DataFrame()

    feature_cols = [
        c
        for c in pre_windows.columns
        if c not in ("event_id", "ticker", "event_date", "day_offset")
    ]
    # Pivot to wide: one row per event, columns = feature × day_offset
    pivot_rows: list[dict] = []
    for eid, grp in pre_windows.groupby("event_id"):
        row = {"event_id": eid, "ticker": grp["ticker"].iloc[0]}
        for col in feature_cols:
            for off in sorted(grp["day_offset"].unique()):
                val = grp.loc[grp["day_offset"] == off, col]
                row[f"{col}_{off}"] = val.iloc[0] if len(val) else np.nan
        pivot_rows.append(row)

    wide = pd.DataFrame(pivot_rows)
    X = wide.drop(columns=["event_id", "ticker"], errors="ignore")
    imp = SimpleImputer(strategy="median")
    X_imp = imp.fit_transform(X)
    n_events = X_imp.shape[0]
    k = min(n_clusters, max(1, n_events))

    if n_events < k:
        wide["cluster"] = 0
        wide["archetype_note"] = "insufficient events for clustering"
        return wide

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_imp)
    km = KMeans(n_clusters=k, random_state=0, n_init=10)
    wide["cluster"] = km.fit_predict(X_scaled)
    wide["archetype_note"] = wide["cluster"].map(
        lambda c: f"archetype_{c} (k={k}, n_events={n_events})"
    )
    return wide


def feature_importance_pre_event(
    pre_windows: pd.DataFrame,
    ctrl_windows: pd.DataFrame,
) -> pd.DataFrame:
    """Random forest: classify pre-event windows vs control windows."""
    pre_agg = aggregate_window_features(pre_windows, "event_id")
    ctrl_agg = aggregate_window_features(ctrl_windows, "control_id")
    if pre_agg.empty or ctrl_agg.empty:
        return pd.DataFrame()

    pre_agg["label"] = 1
    ctrl_agg["label"] = 0
    feature_cols = [c for c in pre_agg.columns if c not in ("event_id", "ticker", "label")]
    combined = pd.concat([pre_agg, ctrl_agg], ignore_index=True)
    X = combined[feature_cols]
    y = combined["label"]

    imp = SimpleImputer(strategy="median")
    X_imp = imp.fit_transform(X)
    if len(y.unique()) < 2 or len(y) < 6:
        return pd.DataFrame({"feature": feature_cols, "importance": np.nan})

    rf = RandomForestClassifier(n_estimators=100, max_depth=4, random_state=0)
    rf.fit(X_imp, y)
    return (
        pd.DataFrame({"feature": feature_cols, "importance": rf.feature_importances_})
        .sort_values("importance", ascending=False)
        .reset_index(drop=True)
    )


def run_pattern_mining(df: pd.DataFrame, window: int = 20) -> PatternMiningResult:
    warnings_list: list[str] = []
    pre = extract_pre_event_windows(df, window=window)
    ctrl = build_control_windows(df, window=window)
    n_pre = pre["event_id"].nunique() if not pre.empty else 0
    n_ctrl = ctrl["control_id"].nunique() if not ctrl.empty else 0

    if n_pre < MIN_EVENTS_FOR_SIGNIFICANCE:
        warnings_list.append(
            f"Only {n_pre} pre-event windows — patterns are hypotheses, not validated signals."
        )

    comparisons = compare_pre_event_vs_control(pre, ctrl)
    clusters = cluster_pre_event_archetypes(pre, window=window)
    importance = feature_importance_pre_event(pre, ctrl)

    trustworthy = n_pre >= MIN_EVENTS_FOR_SIGNIFICANCE and n_ctrl >= MIN_EVENTS_FOR_SIGNIFICANCE
    if not comparisons.empty:
        n_sig = comparisons["significant_05"].sum()
        if n_sig > 0 and not trustworthy:
            warnings_list.append(
                f"{n_sig} feature(s) pass p<0.05 but sample is too small — likely false discovery."
            )

    return PatternMiningResult(
        comparisons=comparisons,
        cluster_labels=clusters,
        feature_importance=importance,
        n_pre_events=n_pre,
        n_controls=n_ctrl,
        trustworthy=trustworthy,
        warnings=warnings_list,
    )


def plot_feature_comparison(result: PatternMiningResult, output: Path | None = None) -> Path | None:
    if result.comparisons.empty:
        return None
    output = output or REPORTS_DIR / "pre_event_feature_comparison.png"
    output.parent.mkdir(parents=True, exist_ok=True)

    top = result.comparisons.dropna(subset=["p_value"]).head(8)
    if top.empty:
        return None

    fig, ax = plt.subplots(figsize=(8, 4))
    x = np.arange(len(top))
    w = 0.35
    ax.bar(x - w / 2, top["pre_mean"], w, label="Pre-EIS windows", color="seagreen")
    ax.bar(x + w / 2, top["ctrl_mean"], w, label="Control windows", color="gray")
    ax.set_xticks(x)
    ax.set_xticklabels(top["feature"], rotation=35, ha="right")
    ax.set_title("Pre-event vs control (top features by p-value)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output, dpi=120)
    plt.close(fig)
    return output
