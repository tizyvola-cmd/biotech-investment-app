"""
Catalyst table — directional Bias score (Framework v2 signal 3).

Display only — not a Soft BUY/SELL input.

Weights below are ARBITRARY starting points (brief): calibrate with historical
backtest later. They are configurable via ``BiasWeights`` — never treat as truth.

  sign_RR       = +1 if RR > +5pts, -1 if RR < -5pts, else 0
  sign_PriceVol = +1 together↑, -1 together↓, 0 diverge/other
  sign_Insider  = +1 if InsiderNetBuy_30d > 0, -1 if < 0, 0 if absent
  sign_Sector   = +1 if RelativeMove > 0, -1 if < 0, 0 if absent

  BiasScore = 0.35*sign_RR + 0.30*sign_PriceVol + 0.15*sign_Insider + 0.20*sign_Sector

Label:
  >  0.3 → Bullish build
  < -0.3 → Fear / hedge
  else   → Mixed / inconclusive
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


# Arbitrary starting weights — DA CALIBRARE (brief). Not Soft BUY/SELL truth.
DEFAULT_W_RR = 0.35
DEFAULT_W_PRICE_VOL = 0.30
DEFAULT_W_INSIDER = 0.15
DEFAULT_W_SECTOR = 0.20
BIAS_BULL_THRESHOLD = 0.3
BIAS_BEAR_THRESHOLD = -0.3
# RR is stored as decimal (0.05 = +5 pts). Brief threshold is ±5 pts.
RR_SIGN_THRESHOLD = 0.05


@dataclass(frozen=True)
class BiasWeights:
    """Configurable BiasScore weights (arbitrary defaults — not calibrated)."""

    w_rr: float = DEFAULT_W_RR
    w_price_vol: float = DEFAULT_W_PRICE_VOL
    w_insider: float = DEFAULT_W_INSIDER
    w_sector: float = DEFAULT_W_SECTOR
    bull_threshold: float = BIAS_BULL_THRESHOLD
    bear_threshold: float = BIAS_BEAR_THRESHOLD
    rr_threshold: float = RR_SIGN_THRESHOLD


def sign_rr(rr10: float | None, *, threshold: float = RR_SIGN_THRESHOLD) -> int:
    if rr10 is None:
        return 0
    if rr10 > threshold:
        return 1
    if rr10 < -threshold:
        return -1
    return 0


def sign_price_vol(kind: str | None) -> int:
    """kind: 'together_up' | 'together_down' | 'diverge' | other."""
    k = str(kind or "").strip().lower().replace(" ", "_")
    if k in ("together_up", "together_↑", "insieme_↑", "up"):
        return 1
    if k in ("together_down", "together_↓", "insieme_↓", "down"):
        return -1
    return 0


def sign_insider(net_buy_30d: float | None) -> int:
    if net_buy_30d is None:
        return 0
    if net_buy_30d > 0:
        return 1
    if net_buy_30d < 0:
        return -1
    return 0


def sign_sector(relative_move: float | None) -> int:
    if relative_move is None:
        return 0
    if relative_move > 0:
        return 1
    if relative_move < 0:
        return -1
    return 0


def bias_label(score: float | None, weights: BiasWeights | None = None) -> str | None:
    if score is None:
        return None
    w = weights or BiasWeights()
    if score > w.bull_threshold:
        return "bullish_build"
    if score < w.bear_threshold:
        return "fear_hedge"
    return "mixed"


def compute_bias_score(
    *,
    rr10: float | None = None,
    price_vol_kind: str | None = None,
    insider_net_buy_30d: float | None = None,
    relative_move: float | None = None,
    weights: BiasWeights | None = None,
) -> dict[str, Any]:
    """
    Pure BiasScore. Returns None score when every input sign is 0 / absent
    (nothing to lean on) — UI shows "—", never a fake 0.0 conviction.
    """
    w = weights or BiasWeights()
    s_rr = sign_rr(rr10, threshold=w.rr_threshold)
    s_pv = sign_price_vol(price_vol_kind)
    s_in = sign_insider(insider_net_buy_30d)
    s_sec = sign_sector(relative_move)
    if s_rr == 0 and s_pv == 0 and s_in == 0 and s_sec == 0:
        return {
            "bias_score": None,
            "bias_label": None,
            "sign_rr": 0,
            "sign_price_vol": 0,
            "sign_insider": 0,
            "sign_sector": 0,
            "weights": asdict(w),
            "weights_note": "arbitrary_uncalibrated",
            "status": "none",
        }
    score = (
        w.w_rr * s_rr
        + w.w_price_vol * s_pv
        + w.w_insider * s_in
        + w.w_sector * s_sec
    )
    score = round(score, 4)
    return {
        "bias_score": score,
        "bias_label": bias_label(score, w),
        "sign_rr": s_rr,
        "sign_price_vol": s_pv,
        "sign_insider": s_in,
        "sign_sector": s_sec,
        "weights": asdict(w),
        "weights_note": "arbitrary_uncalibrated",
        "status": "ok",
    }
