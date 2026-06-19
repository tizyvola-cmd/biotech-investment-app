"""Probabilistic Curve Generator — Monte Carlo paths with MRM drift/vol."""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from prediction.v5.mrm import MarketRegime
from prediction.v5.schema import NODE_OFFSETS, CurveNodeQuantiles, PredictionDistribution


def generate_curve_distribution(
    regime: MarketRegime,
    *,
    n_paths: int = 2000,
    seed: int | None = None,
    cd_anchor_pct: float | None = None,
    cohort_mu_by_offset: dict[int, float] | None = None,
    prior_weight: float = 0.22,
    anchor_weight: float = 0.35,
) -> PredictionDistribution:
    """
    Simulate cumulative % moves vs T-60, blend toward optional cohort prior and CD anchor.
    """
    rng = np.random.default_rng(seed)
    offsets = NODE_OFFSETS
    t0 = offsets[0]
    t1 = offsets[-1]
    span = t1 - t0
    if span <= 0:
        raise ValueError("invalid node span")

    # Daily grid from T-60 to CD+7
    days = list(range(t0, t1 + 1))
    n_days = len(days)
    dt = 1.0 / max(span, 1)

    paths = np.zeros((n_paths, n_days), dtype=np.float64)
    for i in range(1, n_days):
        shocks = rng.normal(0.0, 1.0, size=n_paths)
        paths[:, i] = paths[:, i - 1] + regime.drift_per_day * dt + regime.sigma_per_day * shocks * math.sqrt(dt)

    if cohort_mu_by_offset:
        for j, d in enumerate(days):
            mu = cohort_mu_by_offset.get(d)
            if mu is not None:
                paths[:, j] = (1.0 - prior_weight) * paths[:, j] + prior_weight * float(mu)

    if cd_anchor_pct is not None:
        cd_ix = days.index(0) if 0 in days else None
        if cd_ix is not None:
            gap = float(cd_anchor_pct) - paths[:, cd_ix]
            paths[:, cd_ix:] += anchor_weight * gap[:, np.newaxis]

    # Quantiles at each node offset
    nodes: dict[int, CurveNodeQuantiles] = {}
    for off in offsets:
        if off not in days:
            continue
        ix = days.index(off)
        sample = paths[:, ix]
        q05, q50, q95 = np.percentile(sample, [5, 50, 95])
        nodes[off] = CurveNodeQuantiles(
            offset=off,
            q05=float(q05),
            q50=float(q50),
            q95=float(q95),
        )

    # Enforce ordering (numerical noise)
    for off, node in list(nodes.items()):
        lo, mid, hi = sorted([node.q05, node.q50, node.q95])
        nodes[off] = CurveNodeQuantiles(offset=off, q05=lo, q50=mid, q95=hi)

    return PredictionDistribution(
        nodes=nodes,
        regime=regime.label,
        metadata={
            "n_paths": n_paths,
            "seed": seed,
            "drift_per_day": regime.drift_per_day,
            "sigma_per_day": regime.sigma_per_day,
            "cd_anchor_pct": cd_anchor_pct,
            "prior_weight": prior_weight,
            "anchor_weight": anchor_weight,
        },
    )


def prices_to_cohort_mu(prices: Sequence[float], *, base_offset: int = -60) -> dict[int, float]:
    """Build a coarse cohort mean curve (% vs first price) on NODE_OFFSETS."""
    p = [float(x) for x in prices if x and float(x) > 0]
    if len(p) < 2:
        return {}
    base = p[0]
    # Map evenly spaced samples onto offsets
    idxs = np.linspace(0, len(p) - 1, num=len(NODE_OFFSETS))
    out: dict[int, float] = {}
    for off, ix in zip(NODE_OFFSETS, idxs):
        px = p[int(round(ix))]
        out[off] = (px / base - 1.0) * 100.0
    out[base_offset] = 0.0
    return out
