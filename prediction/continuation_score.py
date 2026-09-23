"""
P(continuation) v2 — sell-only exhaustion signal (prices only, no EIS).

Decision question:
  Position already green and the name has run (g_n ≥ min) — historically, in
  similar rate regimes, how often did the next FORWARD_H days show a material
  drawdown from the setup close (exhaustion) rather than holding up?

Schema (v2):
  - Conditioning: only g_n ≥ P_CONT_SELL_MIN_G (no negative-g10 scoring).
  - Label y: 1 if min(close[t+1..t+H]) / close[t] − 1 ≤ −DRAWDOWN_Y_PCT%
    (close-path proxy; HistLib has no OHLC highs).
  - p_pop / p_own: analogue frequencies of y at rate ≈ g_now (v1 matching).
  - p_continuation: shrinkage blend of p_own toward p_pop.
  - p_base: mean y in the same g_n bucket as g_now (not global g>0).
  - sell_edge: p_continuation − p_base  (positive → more exhaustion than bucket).

Sell timing:
  green book + g_n ≥ min + sell_edge > 0.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
_PRICE_CACHE = _ROOT / "data" / "price_cache"
_HISTCV_TAG = "HISTCV_max_cv"
_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")

# Setup window n (trading days) and forward exhaustion horizon.
PRIMARY_WINDOW = 10
FORWARD_H = 5
MIN_BARS = PRIMARY_WINDOW + FORWARD_H + 5

# Analogue matching for rate x: |g - x| <= max(ABS_PP, REL*|x|)  (unchanged from v1)
MATCH_ABS_PP = 3.0
MATCH_REL = 0.25

MIN_ANALOGUES_POP = 30
MIN_ANALOGUES_OWN = 8
# Shrink p_own toward p_pop when own analogues are few.
PRIOR_OWN_STRENGTH = 20

# Library build: step through history (speed); 1 = every bar.
LIBRARY_STRIDE = 5
OWN_MIN_SAMPLES_Z = 24
OWN_LOOKBACK_DAYS = 504

# Sell-only: score only when the name has already run this hard.
P_CONT_SELL_MIN_G = 5.0
# Chart geometry: include mild positive runs so weak-run names sit on the
# half-bell (sell edge / P scoring still gated by P_CONT_SELL_MIN_G).
CHART_MIN_G = 0.0
# Variant A: drawdown from setup close over FORWARD_H (close-path proxy).
DRAWDOWN_Y_PCT = 5.0
# Bucket width (pp) for p_base(g10).
BUCKET_WIDTH_PP = 5.0
OUTCOME_METHOD = "v2_drawdown_from_start"

# Percentile→P(continuation) response curves (chart geometry).
PERCENTILE_BINS = 10
MIN_PERCENTILE_BIN_N = 30
# Per-ticker libraries are smaller (~40–200 rising events) — Pop's 30/bin
# empties Own. Prefer ≥5/bin; adaptive bin count keeps thin Own curves visible
# (Evaluation detail like COCP) instead of Population-only charts.
MIN_PERCENTILE_BIN_N_OWN = 5
MIN_OWN_CURVE_BINS = 3
# Light 3-point moving average on bin centers when enough bins exist.
CURVE_SMOOTH_WINDOW = 3

# Legacy normal-curve params (diagnostic only; chart no longer uses them).
DIST_SAMPLE_MAX = 600
DIST_MIN_N = 16
DIST_OWN_MIN_ANALOGUE = 5


@dataclass(frozen=True)
class ContinuationFeatures:
    g5: float | None
    g10: float | None
    g20: float | None
    decel: float | None
    vol20: float | None
    z_own: float | None
    pct_pop: float | None
    n_pop: int
    n_own: int
    asof: str | None
    # Empirical exhaustion frequencies (0..100): P(drawdown ≥ Y% | rate≈g)
    p_own: float | None = None
    p_pop: float | None = None
    p_base: float | None = None
    n_own_emp: int = 0
    n_pop_emp: int = 0
    n_base: int = 0
    # p_continuation - p_base (positive = more exhaustion than bucket → sell)
    sell_edge: float | None = None
    g10_bucket_lo: float | None = None
    # Rate percentile (0..100) within own / pop rising libraries (chart X).
    pct_own_rate: float | None = None
    pct_pop_rate: float | None = None
    # Empirical P(continuation)=100−P(exhaustion) curves: [{pct,p,n}, ...]
    curve_own: tuple[dict[str, float | int], ...] = ()
    curve_pop: tuple[dict[str, float | int], ...] = ()
    # Legacy normal approx (unused by chart; kept for back-compat columns).
    dist_own_mu: float | None = None
    dist_own_sigma: float | None = None
    dist_own_n: int = 0
    dist_pop_mu: float | None = None
    dist_pop_sigma: float | None = None
    dist_pop_n: int = 0


@dataclass(frozen=True)
class ContinuationScore:
    ticker: str
    p_continuation: float | None  # 0..100 empirical blended
    band: str
    features: ContinuationFeatures
    reason: str | None = None

    def to_row_fields(self) -> dict[str, Any]:
        f = self.features
        return {
            "p_continuation": self.p_continuation,
            "cont_band": self.band,
            "cont_g5": f.g5,
            "cont_g10": f.g10,
            "cont_g20": f.g20,
            "cont_decel": f.decel,
            "cont_vol20": f.vol20,
            "cont_z_own": f.z_own,
            "cont_n_pop": f.n_pop,
            "cont_n_own": f.n_own,
            "cont_asof": f.asof,
            "cont_p_own": f.p_own,
            "cont_p_pop": f.p_pop,
            "cont_p_base": f.p_base,
            "cont_n_own_emp": f.n_own_emp,
            "cont_n_pop_emp": f.n_pop_emp,
            "cont_n_base": f.n_base,
            "cont_sell_edge": f.sell_edge,
            "cont_g10_bucket_lo": f.g10_bucket_lo,
            "cont_outcome": OUTCOME_METHOD,
            "cont_drawdown_y_pct": DRAWDOWN_Y_PCT,
            # Rate percentiles for chart X (library g≥min); CS today kept as cont_pct_cs.
            "cont_pct_own": f.pct_own_rate,
            "cont_pct_pop": f.pct_pop_rate,
            "cont_pct_cs": f.pct_pop,
            "cont_curve_own": list(f.curve_own),
            "cont_curve_pop": list(f.curve_pop),
            "cont_dist_own_mu": f.dist_own_mu,
            "cont_dist_own_sigma": f.dist_own_sigma,
            "cont_dist_own_n": f.dist_own_n,
            "cont_dist_pop_mu": f.dist_pop_mu,
            "cont_dist_pop_sigma": f.dist_pop_sigma,
            "cont_dist_pop_n": f.dist_pop_n,
            "cont_reason": self.reason,
        }


def _safe_sym(ticker: str) -> str:
    return _SAFE_RE.sub("_", (ticker or "").strip().upper()) or "UNK"


def histlib_pickle_path(ticker: str, cache_dir: Path | None = None) -> Path:
    root = cache_dir or _PRICE_CACHE
    return root / f"{_safe_sym(ticker)}_{_HISTCV_TAG}.pkl"


def list_histlib_tickers(cache_dir: Path | None = None) -> list[str]:
    root = cache_dir or _PRICE_CACHE
    if not root.is_dir():
        return []
    out: list[str] = []
    suffix = f"_{_HISTCV_TAG}.pkl"
    for p in root.glob(f"*{suffix}"):
        name = p.name[: -len(suffix)]
        if name:
            out.append(name.upper())
    return sorted(set(out))


def load_close_series(ticker: str, cache_dir: Path | None = None):
    """Return normalized 1-D Close Series or None."""
    import pandas as pd

    path = histlib_pickle_path(ticker, cache_dir)
    if not path.is_file():
        return None
    try:
        obj = pd.read_pickle(path)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    c = obj.get("close")
    if c is None or getattr(c, "empty", True):
        return None
    try:
        s = pd.Series(np.asarray(c, dtype=float).reshape(-1), index=getattr(c, "index", None))
        s = s.replace([np.inf, -np.inf], np.nan).dropna()
        if getattr(s.index, "tz", None) is not None:
            s.index = s.index.tz_localize(None)
        s.index = pd.DatetimeIndex(s.index).normalize()
        s = s[~s.index.duplicated(keep="last")].sort_index()
        return s if len(s) >= MIN_BARS else None
    except Exception:
        return None


def _asof_slice(closes, asof: date | datetime | None):
    import pandas as pd

    if closes is None or getattr(closes, "empty", True):
        return closes
    if asof is None:
        return closes
    end = pd.Timestamp(asof).normalize()
    return closes.loc[closes.index <= end]


def _vals(closes) -> np.ndarray:
    return np.asarray(closes.to_numpy(dtype=float), dtype=float).reshape(-1)


def growth_pct(closes: Sequence[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    p0 = float(closes[-n])
    p1 = float(closes[-1])
    if p0 <= 0 or not math.isfinite(p0) or not math.isfinite(p1):
        return None
    return round((p1 / p0 - 1.0) * 100.0, 4)


def vol20_pct(closes: Sequence[float]) -> float | None:
    if len(closes) < 21:
        return None
    arr = np.asarray(closes[-21:], dtype=float)
    if np.any(arr[:-1] <= 0):
        return None
    rets = np.diff(arr) / arr[:-1]
    if len(rets) < 10:
        return None
    return round(float(np.std(rets, ddof=1) * 100.0), 4)


def deceleration(g5: float | None, g10: float | None) -> float | None:
    if g5 is None or g10 is None:
        return None
    return round(g5 - g10 * 0.5, 4)


def rolling_window_returns(closes, window: int = PRIMARY_WINDOW) -> np.ndarray:
    vals = _vals(closes) if hasattr(closes, "to_numpy") else np.asarray(closes, dtype=float).reshape(-1)
    if len(vals) < window:
        return np.array([], dtype=float)
    out: list[float] = []
    for i in range(window - 1, len(vals)):
        p0 = vals[i - window + 1]
        p1 = vals[i]
        if p0 > 0 and math.isfinite(p0) and math.isfinite(p1):
            out.append((p1 / p0 - 1.0) * 100.0)
    return np.asarray(out, dtype=float)


def z_own_for_g(
    closes,
    g_now: float | None,
    window: int = PRIMARY_WINDOW,
    lookback_bars: int = OWN_LOOKBACK_DAYS,
) -> tuple[float | None, int]:
    if g_now is None or not math.isfinite(g_now):
        return None, 0
    hist = rolling_window_returns(closes, window)
    if len(hist) < OWN_MIN_SAMPLES_Z + 1:
        return None, int(len(hist))
    ref = hist[-(lookback_bars + 1) : -1]
    if len(ref) < OWN_MIN_SAMPLES_Z:
        return None, int(len(ref))
    mu = float(np.mean(ref))
    sd = float(np.std(ref, ddof=1))
    if sd < 1e-6:
        return 0.0, int(len(ref))
    return round((g_now - mu) / sd, 4), int(len(ref))


def percentile_of(value: float, population: Sequence[float]) -> float | None:
    if not population or not math.isfinite(value):
        return None
    arr = np.asarray(population, dtype=float)
    arr = arr[np.isfinite(arr)]
    if len(arr) < 5:
        return None
    return round(float(np.mean(arr < value) * 100.0), 2)


def match_tolerance(g_now: float) -> float:
    return max(MATCH_ABS_PP, MATCH_REL * abs(g_now))


def rate_matches(g_hist: float, g_now: float) -> bool:
    """Same-sign (for rises) and within dynamic tolerance of rate x."""
    if not math.isfinite(g_hist) or not math.isfinite(g_now):
        return False
    if g_now > 0 and g_hist <= 0:
        return False
    if g_now < 0 and g_hist >= 0:
        return False
    return abs(g_hist - g_now) <= match_tolerance(g_now)


def forward_drawdown_label(
    p1: float,
    fwd: np.ndarray,
    *,
    y_pct: float = DRAWDOWN_Y_PCT,
) -> float:
    """1 if close-path drawdown from setup close reaches ≤ −y_pct% within fwd."""
    if p1 <= 0 or fwd.size == 0 or not math.isfinite(p1):
        return 0.0
    if not np.isfinite(fwd).all():
        return 0.0
    dd = (float(np.min(fwd)) / p1 - 1.0) * 100.0
    return 1.0 if dd <= -abs(y_pct) else 0.0


def g10_bucket_lo(g: float, *, width: float = BUCKET_WIDTH_PP, gmin: float = P_CONT_SELL_MIN_G) -> float:
    """Lower edge of the g10 bucket containing g (buckets start at gmin)."""
    if not math.isfinite(g) or width <= 0:
        return gmin
    if g < gmin:
        return gmin
    return float(gmin + width * math.floor((g - gmin) / width))


def extract_analogue_pairs(
    closes,
    *,
    window: int = PRIMARY_WINDOW,
    forward_h: int = FORWARD_H,
    stride: int = LIBRARY_STRIDE,
    min_g: float = P_CONT_SELL_MIN_G,
    drawdown_y_pct: float = DRAWDOWN_Y_PCT,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Past (g_n, exhausted) pairs with no look-ahead — sell-only library.
    at index i: g_n from closes[i-window+1..i]; y from min(closes[i+1..i+H]) vs close[i].
    Only keeps setups with g_n ≥ min_g.
    """
    vals = _vals(closes)
    n = len(vals)
    last_i = n - 1 - forward_h
    first_i = window - 1
    if last_i < first_i:
        return np.array([], dtype=float), np.array([], dtype=float)
    gs: list[float] = []
    ys: list[float] = []
    for i in range(first_i, last_i + 1, max(1, stride)):
        p0 = vals[i - window + 1]
        p1 = vals[i]
        fwd = vals[i + 1 : i + 1 + forward_h]
        if p0 <= 0 or p1 <= 0 or fwd.size < forward_h:
            continue
        if not (math.isfinite(p0) and math.isfinite(p1) and np.isfinite(fwd).all()):
            continue
        g = (p1 / p0 - 1.0) * 100.0
        if g < min_g:
            continue
        gs.append(g)
        ys.append(forward_drawdown_label(p1, fwd, y_pct=drawdown_y_pct))
    return np.asarray(gs, dtype=float), np.asarray(ys, dtype=float)


def empirical_continuation_rate(
    g_now: float,
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    min_n: int,
) -> tuple[float | None, int]:
    """P(exhaustion | g ≈ g_now) in 0..100 from analogue library (v2 label)."""
    if g_hist.size == 0 or y_hist.size == 0 or not math.isfinite(g_now):
        return None, 0
    if g_now < P_CONT_SELL_MIN_G:
        return None, 0
    tol = match_tolerance(g_now)
    mask = (g_hist >= P_CONT_SELL_MIN_G) & (np.abs(g_hist - g_now) <= tol)
    n = int(np.sum(mask))
    if n < min_n:
        return None, n
    p = float(np.mean(y_hist[mask]) * 100.0)
    return round(p, 1), n


def base_rise_continuation_rate(
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    min_g: float = P_CONT_SELL_MIN_G,
    min_n: int = MIN_ANALOGUES_POP,
) -> tuple[float | None, int]:
    """Legacy name: P(exhaustion | g_n ≥ min_g) across all rising setups."""
    if g_hist.size == 0:
        return None, 0
    mask = g_hist >= min_g
    n = int(np.sum(mask))
    if n < min_n:
        return None, n
    return round(float(np.mean(y_hist[mask]) * 100.0), 1), n


def bucket_base_exhaustion_rate(
    g_now: float,
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    width: float = BUCKET_WIDTH_PP,
    min_n: int = MIN_ANALOGUES_POP,
) -> tuple[float | None, int, float | None]:
    """p_base in the same g10 bucket as g_now. Returns (p, n, bucket_lo)."""
    if g_hist.size == 0 or not math.isfinite(g_now) or g_now < P_CONT_SELL_MIN_G:
        return None, 0, None
    lo = g10_bucket_lo(g_now, width=width)
    hi = lo + width
    mask = (g_hist >= lo) & (g_hist < hi)
    # Open-ended top bucket: fold very large g into last finite edge
    if lo >= P_CONT_SELL_MIN_G + 7 * width:
        mask = g_hist >= lo
    n = int(np.sum(mask))
    if n < min_n:
        return None, n, lo
    return round(float(np.mean(y_hist[mask]) * 100.0), 1), n, lo


def sample_p_continuation_distribution(
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    max_samples: int = DIST_SAMPLE_MAX,
    min_analogue: int = MIN_ANALOGUES_OWN,
    min_n: int = DIST_MIN_N,
) -> tuple[float | None, float | None, int]:
    """
    Legacy: sample historical rising rates → empirical P(exhaustion|rate≈g).
    Chart no longer uses this; kept for back-compat snapshot columns.
    """
    if g_hist.size == 0 or y_hist.size == 0:
        return None, None, 0
    rise = g_hist >= P_CONT_SELL_MIN_G
    g_cands = g_hist[rise]
    if g_cands.size < min_n:
        return None, None, int(g_cands.size)
    # Evenly spaced sample across the rate spectrum (stable, no RNG).
    n_take = min(max_samples, int(g_cands.size))
    idx = np.linspace(0, g_cands.size - 1, n_take).astype(int)
    # Dedupe nearly-identical rates
    seen: set[int] = set()
    ps: list[float] = []
    for i in idx:
        g = float(g_cands[i])
        bucket = int(round(g * 2))  # 0.5pp buckets
        if bucket in seen:
            continue
        seen.add(bucket)
        p, n = empirical_continuation_rate(
            g, g_hist, y_hist, min_n=min_analogue
        )
        if p is not None:
            ps.append(p)
    if len(ps) < min_n:
        return None, None, len(ps)
    arr = np.asarray(ps, dtype=float)
    mu = float(np.mean(arr))
    sigma = float(np.std(arr, ddof=1))
    if not math.isfinite(sigma) or sigma < 0.5:
        sigma = 0.5
    return round(mu, 2), round(sigma, 2), int(len(ps))


def rate_percentile_among(
    g_now: float,
    g_ref: np.ndarray,
    *,
    min_g: float = CHART_MIN_G,
) -> float | None:
    """Percentile of g_now among rising rates in g_ref (0..100)."""
    if not math.isfinite(g_now) or g_now < min_g or g_ref.size == 0:
        return None
    ref = g_ref[np.isfinite(g_ref) & (g_ref >= min_g)]
    if ref.size < 5:
        return None
    return round(float(np.mean(ref < g_now) * 100.0), 2)


def build_percentile_continuation_curve(
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    n_bins: int = PERCENTILE_BINS,
    min_n: int = MIN_PERCENTILE_BIN_N,
    min_g: float = CHART_MIN_G,
    smooth_window: int = CURVE_SMOOTH_WINDOW,
) -> list[dict[str, float | int]]:
    """
    Empirical response curve: X = percentile of rate g among rising setups,
    Y = P(continuation) = 100 × (1 − mean exhaustion label) in that percentile bin.

    Uses deciles by default; drops bins with n < min_n; optional light MA smooth.
    Each point also carries median rate ``g`` in the bin (UI placement fallback).
    """
    if g_hist.size == 0 or y_hist.size == 0 or n_bins < 2:
        return []
    mask = np.isfinite(g_hist) & np.isfinite(y_hist) & (g_hist >= min_g)
    g = g_hist[mask]
    y = y_hist[mask]
    if g.size < min_n:
        return []
    # Percentile rank of each event within the rising library.
    order = np.argsort(g, kind="mergesort")
    ranks = np.empty(g.size, dtype=float)
    ranks[order] = np.arange(g.size, dtype=float)
    pcts = (ranks / max(g.size - 1, 1)) * 100.0

    width = 100.0 / n_bins
    raw: list[tuple[float, float, int, float]] = []
    for b in range(n_bins):
        lo = b * width
        hi = 100.0 if b == n_bins - 1 else (b + 1) * width
        if b == n_bins - 1:
            bin_m = (pcts >= lo) & (pcts <= hi)
        else:
            bin_m = (pcts >= lo) & (pcts < hi)
        n = int(np.sum(bin_m))
        if n < min_n:
            continue
        # Continuation = did NOT hit exhaustion drawdown.
        p_cont = float((1.0 - np.mean(y[bin_m])) * 100.0)
        mid = (lo + hi) / 2.0
        g_mid = float(np.median(g[bin_m]))
        raw.append((mid, round(p_cont, 1), n, round(g_mid, 3)))

    if not raw:
        return []

    # Light smoothing across adjacent valid bins (does not invent slope).
    if smooth_window >= 3 and len(raw) >= 3:
        half = smooth_window // 2
        smoothed: list[tuple[float, float, int, float]] = []
        for i, (mid, p, n, g_mid) in enumerate(raw):
            lo_i = max(0, i - half)
            hi_i = min(len(raw), i + half + 1)
            window = raw[lo_i:hi_i]
            p_s = round(float(np.mean([w[1] for w in window])), 1)
            smoothed.append((mid, p_s, n, g_mid))
        raw = smoothed

    return [
        {"pct": float(m), "p": float(p), "n": int(n), "g": float(g_mid)}
        for m, p, n, g_mid in raw
    ]


def build_own_percentile_continuation_curve(
    g_hist: np.ndarray,
    y_hist: np.ndarray,
    *,
    min_n: int = MIN_PERCENTILE_BIN_N_OWN,
    min_g: float = CHART_MIN_G,
    smooth_window: int = CURVE_SMOOTH_WINDOW,
) -> list[dict[str, float | int]]:
    """
    Own-ticker response curve with adaptive bin count.

    Equal-width percentile bins need ~min_n × n_bins events. Thin Own libraries
    (e.g. 40–70 rising analogues) fail fixed deciles at min_n=8 and the chart
    falls back to Population-only. Shrink n_bins so average bin mass ≥ min_n.
    """
    if g_hist.size == 0 or y_hist.size == 0:
        return []
    mask = np.isfinite(g_hist) & np.isfinite(y_hist) & (g_hist >= min_g)
    n_rising = int(np.sum(mask))
    if n_rising < min_n * MIN_OWN_CURVE_BINS:
        # Last chance: 2-bin split if we still have a usable sample.
        if n_rising >= min_n * 2:
            return build_percentile_continuation_curve(
                g_hist,
                y_hist,
                n_bins=2,
                min_n=min_n,
                min_g=min_g,
                smooth_window=1,
            )
        return []
    n_bins = max(MIN_OWN_CURVE_BINS, min(PERCENTILE_BINS, n_rising // min_n))
    return build_percentile_continuation_curve(
        g_hist,
        y_hist,
        n_bins=n_bins,
        min_n=min_n,
        min_g=min_g,
        smooth_window=smooth_window if n_bins >= 3 else 1,
    )


def interpolate_curve_p(
    curve: Sequence[dict[str, float | int]],
    pct: float | None,
) -> float | None:
    """Linear interpolate Y=P(continuation) at rate percentile pct."""
    if pct is None or not math.isfinite(pct) or not curve:
        return None
    xs = [float(pt["pct"]) for pt in curve]
    ys = [float(pt["p"]) for pt in curve]
    if not xs:
        return None
    if pct <= xs[0]:
        return round(ys[0], 1)
    if pct >= xs[-1]:
        return round(ys[-1], 1)
    for i in range(1, len(xs)):
        if pct <= xs[i]:
            x0, x1 = xs[i - 1], xs[i]
            y0, y1 = ys[i - 1], ys[i]
            if x1 <= x0:
                return round(y1, 1)
            t = (pct - x0) / (x1 - x0)
            return round(y0 + t * (y1 - y0), 1)
    return round(ys[-1], 1)


def blend_own_pop(
    p_own: float | None,
    n_own: int,
    p_pop: float | None,
    *,
    prior_n: int = PRIOR_OWN_STRENGTH,
) -> float | None:
    """Shrink p_own toward p_pop; fall back to p_pop if own missing."""
    if p_pop is None and p_own is None:
        return None
    if p_own is None:
        return p_pop
    if p_pop is None:
        return p_own
    w_own = max(0, n_own)
    w_pop = max(1, prior_n)
    return round((w_own * p_own + w_pop * p_pop) / (w_own + w_pop), 1)


def band_for_dynamic(p: float | None, p_base: float | None) -> str:
    """
    Band on exhaustion edge vs bucket base.
    high = more exhaustion than bucket (sell pressure); low = less.
    """
    if p is None or not math.isfinite(p):
        return "unknown"
    if p_base is None or not math.isfinite(p_base):
        if p >= 55:
            return "high"
        if p <= 35:
            return "low"
        return "mid"
    edge = p - p_base
    if edge > 5:
        return "high"
    if edge < -5:
        return "low"
    return "mid"


def features_from_closes(
    closes,
    *,
    asof: date | datetime | None = None,
    pop_g10: Sequence[float] | None = None,
) -> ContinuationFeatures:
    import pandas as pd

    s = _asof_slice(closes, asof)
    asof_str = None
    if s is not None and not getattr(s, "empty", True):
        try:
            asof_str = str(pd.Timestamp(s.index[-1]).date())
        except Exception:
            asof_str = None
    if s is None or getattr(s, "empty", True) or len(s) < MIN_BARS:
        return ContinuationFeatures(
            None, None, None, None, None, None, None, 0, 0, asof_str
        )

    vals = [float(x) for x in _vals(s)]
    g5 = growth_pct(vals, 5)
    g10 = growth_pct(vals, PRIMARY_WINDOW)
    g20 = growth_pct(vals, 20)
    decel = deceleration(g5, g10)
    vol20 = vol20_pct(vals)
    z, n_own = z_own_for_g(s, g10, PRIMARY_WINDOW, OWN_LOOKBACK_DAYS)
    pop = list(pop_g10) if pop_g10 is not None else []
    pct = percentile_of(g10, pop) if g10 is not None and pop else None
    return ContinuationFeatures(
        g5=g5,
        g10=g10,
        g20=g20,
        decel=decel,
        vol20=vol20,
        z_own=z,
        pct_pop=pct,
        n_pop=len([x for x in pop if math.isfinite(x)]),
        n_own=n_own,
        asof=asof_str,
    )


@dataclass
class AnalogueLibrary:
    """Global historical (g_n, continued) for population; per-ticker for own."""

    pop_g: np.ndarray
    pop_y: np.ndarray
    by_ticker: dict[str, tuple[np.ndarray, np.ndarray]]

    @property
    def n_events(self) -> int:
        return int(self.pop_g.size)


def build_analogue_library(
    tickers: Iterable[str] | None = None,
    *,
    cache_dir: Path | None = None,
    asof: date | datetime | None = None,
    stride: int = LIBRARY_STRIDE,
) -> AnalogueLibrary:
    syms = list(tickers) if tickers is not None else list_histlib_tickers(cache_dir)
    all_g: list[np.ndarray] = []
    all_y: list[np.ndarray] = []
    by_tk: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for tk in syms:
        s = load_close_series(tk, cache_dir)
        if s is None:
            continue
        s = _asof_slice(s, asof)
        if s is None or len(s) < MIN_BARS:
            continue
        # Drop the final FORWARD_H bars from labels by extract_analogue_pairs;
        # also exclude the unfinished current window from own labels (already).
        g, y = extract_analogue_pairs(s, stride=stride)
        if g.size == 0:
            continue
        key = tk.upper()
        by_tk[key] = (g, y)
        all_g.append(g)
        all_y.append(y)
    if not all_g:
        return AnalogueLibrary(
            np.array([], dtype=float), np.array([], dtype=float), {}
        )
    return AnalogueLibrary(
        pop_g=np.concatenate(all_g),
        pop_y=np.concatenate(all_y),
        by_ticker=by_tk,
    )


def score_from_library(
    ticker: str,
    closes,
    library: AnalogueLibrary,
    *,
    asof: date | datetime | None = None,
    pop_g10_today: Sequence[float] | None = None,
    pop_dist: tuple[float | None, float | None, int] | None = None,
    pop_curve: Sequence[dict[str, float | int]] | None = None,
) -> ContinuationScore:
    tk = (ticker or "").strip().upper()
    if closes is None:
        empty = ContinuationFeatures(None, None, None, None, None, None, None, 0, 0, None)
        return ContinuationScore(tk, None, "unknown", empty, reason="no_price_history")

    feat0 = features_from_closes(closes, asof=asof, pop_g10=pop_g10_today)
    g_now = feat0.g10
    curve_pop_t = tuple(pop_curve) if pop_curve else tuple(
        build_percentile_continuation_curve(library.pop_g, library.pop_y)
    )
    if g_now is None:
        return ContinuationScore(
            tk, None, "unknown", feat0, reason="no_g10"
        )
    if g_now < P_CONT_SELL_MIN_G:
        # Keep g10 visible; band = declining vs early run (not yet sell-eligible).
        # Chart geometry (Own+Pop curves, rate percentiles) still ships so the UI
        # matches Evaluation; sell edge / P scoring stay off until g10 ≥ sell floor.
        band = "declining" if g_now < 0 else "not_run"
        pct_pop_rate = (
            rate_percentile_among(g_now, library.pop_g, min_g=CHART_MIN_G)
            if g_now >= CHART_MIN_G
            else None
        )
        own_lib = library.by_ticker.get(tk)
        curve_own_ref: tuple[dict[str, float | int], ...] = ()
        pct_own_rate = None
        if own_lib is not None:
            curve_own_ref = tuple(
                build_own_percentile_continuation_curve(own_lib[0], own_lib[1])
            )
            if g_now >= CHART_MIN_G:
                pct_own_rate = rate_percentile_among(
                    g_now, own_lib[0], min_g=CHART_MIN_G
                )
        feat_ref = ContinuationFeatures(
            g5=feat0.g5,
            g10=feat0.g10,
            g20=feat0.g20,
            decel=feat0.decel,
            vol20=feat0.vol20,
            z_own=feat0.z_own,
            pct_pop=feat0.pct_pop,
            n_pop=feat0.n_pop,
            n_own=feat0.n_own,
            asof=feat0.asof,
            pct_pop_rate=pct_pop_rate,
            pct_own_rate=pct_own_rate,
            curve_own=curve_own_ref,
            curve_pop=curve_pop_t,
        )
        return ContinuationScore(
            tk, None, band, feat_ref, reason="g10_below_sell_threshold"
        )

    own = library.by_ticker.get(tk)
    curve_own_t: tuple[dict[str, float | int], ...] = ()
    pct_own_rate = None
    if own is not None:
        p_own, n_own_emp = empirical_continuation_rate(
            g_now, own[0], own[1], min_n=MIN_ANALOGUES_OWN
        )
        dist_own_mu, dist_own_sigma, dist_own_n = sample_p_continuation_distribution(
            own[0],
            own[1],
            max_samples=min(240, DIST_SAMPLE_MAX),
            min_analogue=DIST_OWN_MIN_ANALOGUE,
            min_n=max(8, DIST_MIN_N // 2),
        )
        curve_own_t = tuple(
            build_own_percentile_continuation_curve(own[0], own[1])
        )
        pct_own_rate = rate_percentile_among(g_now, own[0])
    else:
        p_own, n_own_emp = None, 0
        dist_own_mu, dist_own_sigma, dist_own_n = None, None, 0

    p_pop, n_pop_emp = empirical_continuation_rate(
        g_now, library.pop_g, library.pop_y, min_n=MIN_ANALOGUES_POP
    )
    p_base, n_base, bucket_lo = bucket_base_exhaustion_rate(
        g_now, library.pop_g, library.pop_y
    )
    pct_pop_rate = rate_percentile_among(g_now, library.pop_g)
    if pop_dist is not None:
        dist_pop_mu, dist_pop_sigma, dist_pop_n = pop_dist
    else:
        dist_pop_mu, dist_pop_sigma, dist_pop_n = sample_p_continuation_distribution(
            library.pop_g, library.pop_y
        )

    p = blend_own_pop(p_own, n_own_emp, p_pop)
    edge = None
    if p is not None and p_base is not None:
        edge = round(p - p_base, 1)

    feat = ContinuationFeatures(
        g5=feat0.g5,
        g10=feat0.g10,
        g20=feat0.g20,
        decel=feat0.decel,
        vol20=feat0.vol20,
        z_own=feat0.z_own,
        pct_pop=feat0.pct_pop,
        n_pop=feat0.n_pop,
        n_own=feat0.n_own,
        asof=feat0.asof,
        p_own=p_own,
        p_pop=p_pop,
        p_base=p_base,
        n_own_emp=n_own_emp,
        n_pop_emp=n_pop_emp,
        n_base=n_base,
        sell_edge=edge,
        g10_bucket_lo=bucket_lo,
        pct_own_rate=pct_own_rate,
        pct_pop_rate=pct_pop_rate,
        curve_own=curve_own_t,
        curve_pop=curve_pop_t,
        dist_own_mu=dist_own_mu,
        dist_own_sigma=dist_own_sigma,
        dist_own_n=dist_own_n,
        dist_pop_mu=dist_pop_mu,
        dist_pop_sigma=dist_pop_sigma,
        dist_pop_n=dist_pop_n,
    )
    reason = None
    if p is None:
        reason = "insufficient_analogues"
    return ContinuationScore(tk, p, band_for_dynamic(p, p_base), feat, reason=reason)


def build_population_g10(
    tickers: Iterable[str] | None = None,
    *,
    asof: date | datetime | None = None,
    cache_dir: Path | None = None,
) -> dict[str, float]:
    syms = list(tickers) if tickers is not None else list_histlib_tickers(cache_dir)
    out: dict[str, float] = {}
    for tk in syms:
        s = load_close_series(tk, cache_dir)
        if s is None:
            continue
        feat = features_from_closes(s, asof=asof, pop_g10=None)
        if feat.g10 is not None and math.isfinite(feat.g10):
            out[tk.upper()] = float(feat.g10)
    return out


def score_tickers(
    tickers: Sequence[str],
    *,
    asof: date | datetime | None = None,
    cache_dir: Path | None = None,
    population_tickers: Sequence[str] | None = None,
) -> dict[str, ContinuationScore]:
    pop_syms = (
        list(population_tickers)
        if population_tickers is not None
        else list_histlib_tickers(cache_dir)
    )
    library = build_analogue_library(pop_syms, cache_dir=cache_dir, asof=asof)
    # Today's cross-section g10 for diagnostic pct_cs only (not used in P).
    pop_today = build_population_g10(pop_syms, asof=asof, cache_dir=cache_dir)
    pop_vals = list(pop_today.values())
    pop_dist = sample_p_continuation_distribution(library.pop_g, library.pop_y)
    pop_curve = build_percentile_continuation_curve(library.pop_g, library.pop_y)

    result: dict[str, ContinuationScore] = {}
    for tk in tickers:
        key = (tk or "").strip().upper()
        if not key:
            continue
        closes = load_close_series(key, cache_dir)
        result[key] = score_from_library(
            key,
            closes,
            library,
            asof=asof,
            pop_g10_today=pop_vals,
            pop_dist=pop_dist,
            pop_curve=pop_curve,
        )
    return result


def apply_continuation_to_snapshot(
    snap: dict[str, Any],
    scores: dict[str, ContinuationScore],
) -> dict[str, Any]:
    cols = list(snap.get("columns") or [])
    col_ticker = next((c for c in cols if str(c).lower() == "ticker"), "Ticker")
    new_cols = [
        "p_continuation",
        "cont_band",
        "cont_g5",
        "cont_g10",
        "cont_g20",
        "cont_decel",
        "cont_vol20",
        "cont_z_own",
        "cont_pct_pop",
        "cont_pct_own",
        "cont_pct_cs",
        "cont_n_pop",
        "cont_n_own",
        "cont_asof",
        "cont_p_own",
        "cont_p_pop",
        "cont_p_base",
        "cont_n_own_emp",
        "cont_n_pop_emp",
        "cont_n_base",
        "cont_sell_edge",
        "cont_g10_bucket_lo",
        "cont_outcome",
        "cont_drawdown_y_pct",
        "cont_curve_own",
        "cont_curve_pop",
        "cont_dist_own_mu",
        "cont_dist_own_sigma",
        "cont_dist_own_n",
        "cont_dist_pop_mu",
        "cont_dist_pop_sigma",
        "cont_dist_pop_n",
        "cont_reason",
    ]
    for nc in new_cols:
        if nc not in cols:
            cols.append(nc)
    snap["columns"] = cols

    # Score-field keys that must be cleared when a ticker is below g10 threshold
    # so stale P/edge from a prior enrich cannot linger.
    clear_on_unscored = (
        "p_continuation",
        "cont_band",
        "cont_p_own",
        "cont_p_pop",
        "cont_p_base",
        "cont_n_own_emp",
        "cont_n_pop_emp",
        "cont_n_base",
        "cont_sell_edge",
        "cont_g10_bucket_lo",
        "cont_pct_own",
        "cont_pct_pop",
        "cont_curve_own",
        "cont_curve_pop",
        "cont_dist_own_mu",
        "cont_dist_own_sigma",
        "cont_dist_own_n",
        "cont_dist_pop_mu",
        "cont_dist_pop_sigma",
        "cont_dist_pop_n",
    )

    for row in snap.get("rows") or []:
        if not isinstance(row, dict):
            continue
        tk = str(row.get(col_ticker) or "").strip().upper()
        sc = scores.get(tk)
        if sc is None:
            continue
        fields = sc.to_row_fields()
        if sc.p_continuation is None and sc.reason in {
            "g10_below_sell_threshold",
            "no_g10",
            "no_price_history",
            "insufficient_analogues",
        }:
            # Keep chart geometry (curves + rate percentiles); clear sell scores only.
            keep_chart = {
                "cont_curve_pop": list(fields.get("cont_curve_pop") or []),
                "cont_curve_own": list(fields.get("cont_curve_own") or []),
                "cont_pct_pop": fields.get("cont_pct_pop"),
                "cont_pct_own": fields.get("cont_pct_own"),
            }
            for k in clear_on_unscored:
                if k in keep_chart:
                    fields[k] = keep_chart[k]
                else:
                    fields[k] = None
            # Preserve declining/not_run band; never wipe cont_g10 (not in clear list).
            if sc.band in ("declining", "not_run", "unknown"):
                fields["cont_band"] = sc.band
            else:
                fields["cont_band"] = "unknown"
        row.update(fields)

    pop_curve_meta = next(
        (list(s.features.curve_pop) for s in scores.values() if s.features.curve_pop),
        [],
    )
    snap["continuation_curves"] = {
        "method": OUTCOME_METHOD,
        "y": "continuation_one_minus_drawdown",
        "window_n": PRIMARY_WINDOW,
        "forward_h": FORWARD_H,
        "drawdown_y_pct": DRAWDOWN_Y_PCT,
        "bucket_width_pp": BUCKET_WIDTH_PP,
        "percentile_bins": PERCENTILE_BINS,
        "min_bin_n": MIN_PERCENTILE_BIN_N,
        "population": pop_curve_meta,
    }
    # Legacy key for older UI; prefer continuation_curves.
    pop_meta = next(
        (
            {
                "mu": s.features.dist_pop_mu,
                "sigma": s.features.dist_pop_sigma,
                "n": s.features.dist_pop_n,
                "p_base": s.features.p_base,
            }
            for s in scores.values()
            if s.features.dist_pop_mu is not None
        ),
        None,
    )
    if pop_meta is not None:
        snap["continuation_dist"] = {
            "method": OUTCOME_METHOD,
            "window_n": PRIMARY_WINDOW,
            "forward_h": FORWARD_H,
            "drawdown_y_pct": DRAWDOWN_Y_PCT,
            "bucket_width_pp": BUCKET_WIDTH_PP,
            "population": pop_meta,
        }
    return snap


def enrich_simulation_snapshot_file(
    snap_path: Path | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    path = snap_path or (_ROOT / "data" / "simulation_sheet_snapshot.json")
    if not path.is_file():
        return {"ok": False, "error": "snapshot_missing", "path": str(path)}
    import json

    snap = json.loads(path.read_text(encoding="utf-8"))
    cols = snap.get("columns") or []
    col_ticker = next((c for c in cols if str(c).lower() == "ticker"), "Ticker")
    tickers = sorted(
        {
            str(r.get(col_ticker) or "").strip().upper()
            for r in (snap.get("rows") or [])
            if isinstance(r, dict) and str(r.get(col_ticker) or "").strip()
        }
    )
    scores = score_tickers(tickers)
    apply_continuation_to_snapshot(snap, scores)
    n_ok = sum(1 for s in scores.values() if s.p_continuation is not None)
    if not dry_run:
        path.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
    sample_base = next(
        (s.features.p_base for s in scores.values() if s.features.p_base is not None),
        None,
    )
    return {
        "ok": True,
        "tickers": len(tickers),
        "scored": n_ok,
        "pop_n": max((s.features.n_pop_emp for s in scores.values()), default=0),
        "p_base": sample_base,
        "path": str(path),
        "dry_run": dry_run,
        "method": OUTCOME_METHOD,
        "window_n": PRIMARY_WINDOW,
        "forward_h": FORWARD_H,
        "drawdown_y_pct": DRAWDOWN_Y_PCT,
        "bucket_width_pp": BUCKET_WIDTH_PP,
    }


def sell_timing_hint(
    p_continuation: float | None,
    *,
    mtm_pct: float | None,
    p_base: float | None = None,
    g10: float | None = None,
    sell_edge: float | None = None,
) -> str | None:
    """
    Sell-only: green book + g10≥min + exhaustion edge above bucket base.
    Prefer explicit sell_edge when provided; else p_continuation − p_base.
    """
    if mtm_pct is None or not math.isfinite(mtm_pct) or mtm_pct <= 0:
        return None
    if g10 is None or not math.isfinite(g10) or g10 < P_CONT_SELL_MIN_G:
        return None
    edge = sell_edge
    if edge is None:
        if p_continuation is None or p_base is None:
            return None
        if not (math.isfinite(p_continuation) and math.isfinite(p_base)):
            return None
        edge = p_continuation - p_base
    if not math.isfinite(edge):
        return None
    if edge > 0:
        return "exhaustion_edge_above_bucket_base"
    return None
