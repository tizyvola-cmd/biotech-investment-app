"""Public entry for v5 probabilistic curves."""
from __future__ import annotations

from typing import Sequence

from prediction.config import pred_v5_fund_sigma_enabled
from prediction.v5.mrm import (
    MarketRegime,
    apply_fundamental_sigma_adjustments,
    classify_regime,
    drift_sigma_from_prices,
)
from prediction.v5.pcg import generate_curve_distribution, prices_to_cohort_mu
from prediction.v5.schema import PredictionDistribution


def predict_v5_curve(
    *,
    prices: Sequence[float] | None = None,
    slope_20d: float | None = None,
    vol_20d: float | None = None,
    run_up_30d: float | None = None,
    xbi_slope: float | None = None,
    beta: float | None = None,
    liquidity_score: float | None = None,
    cd_anchor_pct: float | None = None,
    n_paths: int = 2000,
    seed: int | None = None,
    cohort_prices: Sequence[float] | None = None,
    cohort_mu_by_offset: dict[int, float] | None = None,
    apply_fundamental_sigma: bool | None = None,
) -> PredictionDistribution:
    """
    Build a v5 fan chart. Supply either ``prices`` (series) or explicit MRM stats.
    """
    if any(x is not None for x in (slope_20d, vol_20d, run_up_30d)):
        regime = classify_regime(
            slope_20d=slope_20d,
            vol_20d=vol_20d,
            run_up_30d=run_up_30d,
            xbi_slope=xbi_slope,
            beta=beta,
        )
    elif prices is not None and len(prices) >= 5:
        regime = drift_sigma_from_prices(prices, xbi_slope=xbi_slope, beta=beta)
    else:
        regime = classify_regime(
            slope_20d=slope_20d,
            vol_20d=vol_20d,
            run_up_30d=run_up_30d,
            xbi_slope=xbi_slope,
            beta=beta,
        )

    _fund_sigma = (
        pred_v5_fund_sigma_enabled()
        if apply_fundamental_sigma is None
        else bool(apply_fundamental_sigma)
    )
    if _fund_sigma and (beta is not None or liquidity_score is not None):
        regime = apply_fundamental_sigma_adjustments(
            regime,
            beta=beta,
            liquidity_score=liquidity_score,
        )

    cohort_mu = None
    if cohort_mu_by_offset:
        cohort_mu = dict(cohort_mu_by_offset)
    elif cohort_prices is not None and len(cohort_prices) >= 2:
        cohort_mu = prices_to_cohort_mu(cohort_prices)
    elif prices is not None and len(prices) >= 2:
        cohort_mu = prices_to_cohort_mu(prices)

    return generate_curve_distribution(
        regime,
        n_paths=n_paths,
        seed=seed,
        cd_anchor_pct=cd_anchor_pct,
        cohort_mu_by_offset=cohort_mu,
    )
