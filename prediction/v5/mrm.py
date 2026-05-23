"""Market Regime Model — rule-based drift and volatility for Monte Carlo."""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Sequence

RegimeLabel = str  # trend | mean_revert | high_vol


def _env_float(name: str, default: float, *, lo: float | None = None, hi: float | None = None) -> float:
    try:
        v = float(os.environ.get(name, "").strip() or default)
    except ValueError:
        v = default
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


# ── Classification thresholds (overridable via environment variables) ─────────
# Override any of these without changing code to experiment with calibration:
#   MRM_HIGH_VOL_VOL=0.050          (primary vol trigger)
#   MRM_HIGH_VOL_VOL_COMBO=0.035    (vol leg of vol+runup combo)
#   MRM_HIGH_VOL_RUNUP_COMBO=25     (|run_up| leg of vol+runup combo)
#   MRM_HIGH_VOL_BETA=1.7           (beta trigger, independent of vol)
#   MRM_MEAN_REVERT_RUNUP=18        (min run_up to consider mean-reversion)
#   MRM_MEAN_REVERT_SLOPE=0.05      (max slope still eligible for mean-revert)
_HIGH_VOL_VOL: float = _env_float("MRM_HIGH_VOL_VOL", 0.045, lo=0.01, hi=0.20)
_HIGH_VOL_VOL_COMBO: float = _env_float("MRM_HIGH_VOL_VOL_COMBO", 0.035, lo=0.01, hi=0.15)
_HIGH_VOL_RUNUP_COMBO: float = _env_float("MRM_HIGH_VOL_RUNUP_COMBO", 25.0, lo=5.0, hi=60.0)
_HIGH_VOL_BETA: float = _env_float("MRM_HIGH_VOL_BETA", 1.7, lo=1.0, hi=4.0)
_MEAN_REVERT_RUNUP: float = _env_float("MRM_MEAN_REVERT_RUNUP", 18.0, lo=5.0, hi=50.0)
_MEAN_REVERT_SLOPE: float = _env_float("MRM_MEAN_REVERT_SLOPE", 0.05, lo=0.0, hi=0.30)


@dataclass(frozen=True)
class MarketRegime:
    label: RegimeLabel
    drift_per_day: float
    sigma_per_day: float
    metadata: dict


def _f(val: float | None, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        x = float(val)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(x):
        return default
    return x


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def classify_regime(
    *,
    slope_20d: float | None = None,
    vol_20d: float | None = None,
    run_up_30d: float | None = None,
    xbi_slope: float | None = None,
    beta: float | None = None,
) -> MarketRegime:
    """
  Simple rules:
  - ``high_vol`` when realized vol (or vol ratio proxy) is elevated.
  - ``mean_revert`` when extended run-up meets fading short trend.
  - ``trend`` otherwise (drift follows 20d slope sign).
    """
    slope = _f(slope_20d)
    vol = abs(_f(vol_20d, 0.02))
    run_up = _f(run_up_30d)
    xbi = _f(xbi_slope)

    beta_val: float | None = None
    if beta is not None:
        try:
            b = float(beta)
            if math.isfinite(b):
                beta_val = b
        except (TypeError, ValueError):
            beta_val = None

    meta = {
        "slope_20d": slope,
        "vol_20d": vol,
        "run_up_30d": run_up,
        "xbi_slope": xbi,
        "beta": beta_val,
    }

    high_vol_beta = beta_val is not None and beta_val >= _HIGH_VOL_BETA
    if vol >= _HIGH_VOL_VOL or (vol >= _HIGH_VOL_VOL_COMBO and abs(run_up) >= _HIGH_VOL_RUNUP_COMBO) or high_vol_beta:
        drift = slope * 0.35
        sigma = max(0.025, vol * 1.15)
        if high_vol_beta and beta_val is not None:
            meta["high_vol_beta_trigger"] = True
        return MarketRegime("high_vol", drift, sigma, meta)

    if run_up >= _MEAN_REVERT_RUNUP and slope <= _MEAN_REVERT_SLOPE:
        drift = -abs(slope) * 0.6 - 0.0015
        sigma = max(0.018, vol * 0.95)
        return MarketRegime("mean_revert", drift, sigma, meta)

    drift = slope * 0.0012 + xbi * 0.0004
    sigma = max(0.012, vol * 0.85)
    return MarketRegime("trend", drift, sigma, meta)


def drift_sigma_from_prices(
    prices: Sequence[float],
    *,
    xbi_slope: float | None = None,
    beta: float | None = None,
) -> MarketRegime:
    """Derive slope/vol/run-up from a close price series (oldest → newest)."""
    if len(prices) < 5:
        return classify_regime(xbi_slope=xbi_slope, beta=beta)

    p = [float(x) for x in prices if x and float(x) > 0]
    if len(p) < 5:
        return classify_regime(xbi_slope=xbi_slope, beta=beta)

    def _log_rets(seg: list[float]) -> list[float]:
        out: list[float] = []
        for i in range(1, len(seg)):
            out.append(math.log(seg[i] / seg[i - 1]))
        return out

    r20 = _log_rets(p[-21:]) if len(p) >= 21 else _log_rets(p)
    slope_20d = (sum(r20) / len(r20)) * 100.0 if r20 else 0.0
    vol_20d = (sum((x - sum(r20) / len(r20)) ** 2 for x in r20) / len(r20)) ** 0.5 if r20 else 0.02
    run_up_30d = ((p[-1] / p[-min(30, len(p))]) - 1.0) * 100.0
    return classify_regime(
        slope_20d=slope_20d,
        vol_20d=vol_20d,
        run_up_30d=run_up_30d,
        xbi_slope=xbi_slope,
        beta=beta,
    )


def apply_fundamental_sigma_adjustments(
    regime: MarketRegime,
    *,
    beta: float | None = None,
    liquidity_score: float | None = None,
) -> MarketRegime:
    """
    Widen σ when FY liquidity is weak; scale σ by √beta in trend / high_vol regimes.

    Low ``liquidity_score`` → wider fan: ``sigma *= 1 + 0.25 * (1 - score)``.
    """
    sigma = regime.sigma_per_day
    meta = dict(regime.metadata)

    if liquidity_score is not None:
        try:
            liq = float(liquidity_score)
            if math.isfinite(liq):
                liq = _clip(liq, 0.0, 1.0)
                sigma *= 1.0 + 0.25 * (1.0 - liq)
                meta["liquidity_sigma_mult"] = 1.0 + 0.25 * (1.0 - liq)
        except (TypeError, ValueError):
            pass

    if beta is not None and regime.label in ("high_vol", "trend"):
        try:
            b = float(beta)
            if math.isfinite(b) and b > 0:
                mult = _clip(math.sqrt(b), 1.0, 1.45)
                sigma *= mult
                meta["beta_sigma_mult"] = mult
        except (TypeError, ValueError):
            pass

    if sigma == regime.sigma_per_day and meta == regime.metadata:
        return regime
    return MarketRegime(regime.label, regime.drift_per_day, sigma, meta)
