"""Real-time scanner — similarity score to discovered pre-event archetypes."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

from .features import engineer_features
from .model import FEATURES_FOR_MODEL
from .patterns import PatternMiningResult, cluster_pre_event_archetypes, extract_pre_event_windows


@dataclass
class ScannerAlert:
    ticker: str
    as_of: pd.Timestamp
    similarity_score: float
    cluster_id: int | None
    top_features: dict[str, float]
    note: str


def _latest_feature_vector(df: pd.DataFrame, ticker: str) -> pd.Series | None:
    sub = df[df["ticker"] == ticker.upper()].sort_values("date")
    if sub.empty:
        return None
    row = sub.iloc[-1]
    avail = [f for f in FEATURES_FOR_MODEL if f in row.index]
    return row[avail]


def _centroids_from_pre_agg(
    pre_windows: pd.DataFrame,
    cluster_df: pd.DataFrame,
) -> tuple[dict[int, np.ndarray], list[str]]:
    """Build cluster centroids from aggregated pre-event window means."""
    from .features import aggregate_window_features

    if pre_windows.empty or cluster_df.empty or "cluster" not in cluster_df.columns:
        return {}, []

    pre_agg = aggregate_window_features(pre_windows, "event_id")
    merged = pre_agg.merge(cluster_df[["event_id", "cluster"]], on="event_id", how="inner")
    feature_cols = [c for c in pre_agg.columns if c not in ("event_id", "ticker")]
    feature_cols = [c for c in feature_cols if c in FEATURES_FOR_MODEL]

    centroids: dict[int, list[np.ndarray]] = {}
    for _, row in merged.iterrows():
        vec = row[feature_cols].astype(float).values
        centroids.setdefault(int(row["cluster"]), []).append(vec)

    return {k: np.mean(v, axis=0) for k, v in centroids.items() if len(v)}, feature_cols


def scan_ticker(
    df: pd.DataFrame,
    ticker: str,
    pattern_result: PatternMiningResult,
    *,
    window: int = 20,
) -> ScannerAlert | None:
    """
    Score latest day vs pre-event cluster centroids (cosine similarity).
    Returns None if insufficient reference archetypes.
    """
    featured = engineer_features(df) if "volume_zscore_20d" not in df.columns else df
    vec_series = _latest_feature_vector(featured, ticker)
    if vec_series is None:
        return None

    pre = extract_pre_event_windows(featured, window=window)
    clusters = pattern_result.cluster_labels
    if clusters.empty:
        clusters = cluster_pre_event_archetypes(pre, window=window)

    centroids, feature_cols = _centroids_from_pre_agg(pre, clusters)
    if not centroids or not feature_cols:
        return ScannerAlert(
            ticker=ticker.upper(),
            as_of=featured.loc[featured["ticker"] == ticker.upper(), "date"].max(),
            similarity_score=0.0,
            cluster_id=None,
            top_features=vec_series.to_dict(),
            note="No pre-event archetypes learned yet — run pattern mining on more history.",
        )

    vec = vec_series.reindex(feature_cols).astype(float).values.reshape(1, -1)
    imp = SimpleImputer(strategy="median")
    vec_imp = imp.fit_transform(vec).flatten()
    best_sim = -1.0
    best_cluster = None
    for cid, centroid in centroids.items():
        c_imp = imp.transform(centroid.reshape(1, -1)).flatten()
        denom = np.linalg.norm(vec_imp) * np.linalg.norm(c_imp)
        sim = float(np.dot(vec_imp, c_imp) / denom) if denom > 0 else 0.0
        if sim > best_sim:
            best_sim = sim
            best_cluster = cid

    note = (
        "High similarity to pre-EIS archetype — research alert only, not a trade signal."
        if best_sim > 0.7
        else "Moderate/low similarity — no strong pre-event pattern match."
    )
    if not pattern_result.trustworthy:
        note += " (Pattern library not statistically validated.)"

    return ScannerAlert(
        ticker=ticker.upper(),
        as_of=featured.loc[featured["ticker"] == ticker.upper(), "date"].max(),
        similarity_score=round(best_sim, 4),
        cluster_id=best_cluster,
        top_features=vec_series.to_dict(),
        note=note,
    )


def scan_universe(
    df: pd.DataFrame,
    tickers: list[str],
    pattern_result: PatternMiningResult,
) -> pd.DataFrame:
    rows = []
    for tk in tickers:
        alert = scan_ticker(df, tk, pattern_result)
        if alert:
            rows.append(
                {
                    "ticker": alert.ticker,
                    "as_of": alert.as_of,
                    "similarity_score": alert.similarity_score,
                    "cluster_id": alert.cluster_id,
                    "note": alert.note,
                }
            )
    return pd.DataFrame(rows).sort_values("similarity_score", ascending=False)
