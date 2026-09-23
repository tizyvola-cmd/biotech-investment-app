"""Predictive model + walk-forward backtest with random baseline."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler

from .config import MIN_EVENTS_FOR_SIGNIFICANCE, PREDICTION_HORIZON_DAYS, VOLUME_ZSCORE_SPIKE

logger = logging.getLogger(__name__)

FEATURES_FOR_MODEL = [
    "return_1d",
    "return_5d",
    "return_20d",
    "volume_zscore_20d",
    "volume_zscore_60d",
    "volatility_20d",
    "relative_strength_5d",
    "relative_strength_20d",
    "rolling_beta_60d",
    "liquidity_current_ratio_qoq_pct",
    "turnover_ratio",
    "days_since_last_eis",
]


@dataclass
class WalkForwardResult:
    fold_metrics: pd.DataFrame
    aggregate: dict
    backtest: pd.DataFrame
    random_baseline: dict
    n_test_events: int
    trustworthy: bool
    note: str


def build_binary_target(
    df: pd.DataFrame,
    horizon: int = PREDICTION_HORIZON_DAYS,
    volume_z: float = VOLUME_ZSCORE_SPIKE,
) -> pd.DataFrame:
    """
    Target: EIS event with elevated abnormal volume within next `horizon` days.
    Uses only forward EIS flags (for labeling) — features must not include days_to_next_eis.
    """
    out = df.copy()
    out["target"] = 0

    for ticker, g in out.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        eis_idx = g.index[g["eis_flag"].fillna(False)].tolist()
        for idx in eis_idx:
            # Label days in [idx-horizon, idx) if volume spike at event
            vz = g.loc[idx, "volume_zscore_20d"] if "volume_zscore_20d" in g.columns else np.nan
            if pd.isna(vz) or vz < volume_z:
                continue
            for j in range(max(0, idx - horizon), idx):
                out.loc[g.index[j], "target"] = 1
    return out


def walk_forward_logistic(
    df: pd.DataFrame,
    *,
    min_train: int = 60,
    step: int = 20,
    horizon: int = PREDICTION_HORIZON_DAYS,
) -> WalkForwardResult:
    """
    Expanding-window walk-forward validation per ticker, aggregated.
    No random train/test split — temporal order preserved.
    """
    labeled = build_binary_target(df, horizon=horizon)
    fold_rows: list[dict] = []
    bt_rows: list[dict] = []
    all_y_true: list[int] = []
    all_y_pred: list[int] = []
    all_y_prob: list[float] = []

    for ticker, g in labeled.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        avail_features = [f for f in FEATURES_FOR_MODEL if f in g.columns]
        if not avail_features:
            continue

        for test_start in range(min_train, len(g) - 5, step):
            train = g.iloc[:test_start]
            test = g.iloc[test_start : test_start + step]
            if test.empty:
                continue

            X_train = train[avail_features]
            y_train = train["target"]
            X_test = test[avail_features]
            y_test = test["target"]

            if y_train.sum() == 0:
                continue

            imp = SimpleImputer(strategy="median")
            X_tr = imp.fit_transform(X_train)
            X_te = imp.transform(X_test)
            scaler = StandardScaler()
            X_tr = scaler.fit_transform(X_tr)
            X_te = scaler.transform(X_te)

            clf = LogisticRegression(max_iter=500, class_weight="balanced", random_state=0)
            clf.fit(X_tr, y_train)
            prob = clf.predict_proba(X_te)[:, 1]
            pred = (prob >= 0.5).astype(int)

            all_y_true.extend(y_test.tolist())
            all_y_pred.extend(pred.tolist())
            all_y_prob.extend(prob.tolist())

            prec, rec, f1, _ = precision_recall_fscore_support(
                y_test, pred, average="binary", zero_division=0
            )
            auc = roc_auc_score(y_test, prob) if y_test.nunique() > 1 else np.nan

            fold_rows.append(
                {
                    "ticker": ticker,
                    "test_start": test["date"].iloc[0],
                    "n_train": len(train),
                    "n_test": len(test),
                    "n_test_events": int(y_test.sum()),
                    "precision": prec,
                    "recall": rec,
                    "f1": f1,
                    "auc": auc,
                }
            )

            # Simple backtest: buy on signal, hold 5 days
            for i, (_, row) in enumerate(test.iterrows()):
                if pred[i] == 1:
                    fwd = g.loc[g.index > row.name].head(5)
                    if len(fwd):
                        ret = (fwd["close"].iloc[-1] / row["close"]) - 1
                        bt_rows.append({"ticker": ticker, "signal_date": row["date"], "fwd_return_5d": ret})

    fold_df = pd.DataFrame(fold_rows)
    bt_df = pd.DataFrame(bt_rows)

    n_test_events = int(sum(all_y_true)) if all_y_true else 0
    trustworthy = n_test_events >= MIN_EVENTS_FOR_SIGNIFICANCE

    aggregate = {}
    if all_y_true:
        aggregate = {
            "accuracy": accuracy_score(all_y_true, all_y_pred),
            "precision": precision_recall_fscore_support(
                all_y_true, all_y_pred, average="binary", zero_division=0
            )[0],
            "recall": precision_recall_fscore_support(
                all_y_true, all_y_pred, average="binary", zero_division=0
            )[1],
            "auc": roc_auc_score(all_y_true, all_y_prob) if len(set(all_y_true)) > 1 else np.nan,
            "brier": brier_score_loss(all_y_true, all_y_prob),
            "n_predictions": len(all_y_true),
            "n_positive": n_test_events,
        }

    random_baseline = _random_signal_baseline(labeled, signal_rate=max(aggregate.get("precision", 0.05), 0.05))

    note = (
        f"Walk-forward logistic regression. {n_test_events} positive labels in test folds. "
        + (
            "Too few events — metrics are not reliable."
            if not trustworthy
            else "Minimum event count met — extend universe before production use."
        )
    )

    return WalkForwardResult(
        fold_metrics=fold_df,
        aggregate=aggregate,
        backtest=bt_df,
        random_baseline=random_baseline,
        n_test_events=n_test_events,
        trustworthy=trustworthy,
        note=note,
    )


def _random_signal_baseline(df: pd.DataFrame, signal_rate: float = 0.05) -> dict:
    """Compare strategy returns to random signals at same frequency."""
    rng = np.random.default_rng(99)
    rets: list[float] = []
    for ticker, g in df.groupby("ticker"):
        g = g.sort_values("date").reset_index(drop=True)
        n_signals = max(1, int(len(g) * signal_rate))
        idxs = rng.choice(len(g), size=min(n_signals, len(g)), replace=False)
        for idx in idxs:
            fwd = g.iloc[idx + 1 : idx + 6]
            if len(fwd):
                rets.append((fwd["close"].iloc[-1] / g.iloc[idx]["close"]) - 1)
    if not rets:
        return {"mean_fwd_return_5d": np.nan, "n_signals": 0}
    return {"mean_fwd_return_5d": float(np.mean(rets)), "n_signals": len(rets)}
