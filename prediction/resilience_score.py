"""Resilience Score — intrinsic recovery & growth capacity per ticker.

Purpose
-------
Estimate a ticker's ability to (a) recover from a drawdown and (b) grow
in general (including surviving broad market crises), from its own price
history — **without overlap with SDS or Regulatory scores**.

Design constraints (see chat 2026-07-14, user "io rivederei la logica"):
- MUST NOT reuse SDS-cluster-C features (`xbi_relative_strength.rs_90d`,
  `volume_ratio`, etc.), pre-CD price pattern, or `pplan`. Those are the
  domain of SDS and would create a redundant correlation.
- MUST NOT reuse regulatory event signals (PDUFA/CRL/CMC) — that is the
  domain of Regulatory score.
- MUST use ONLY the ticker's own long price history and the XBI benchmark
  as raw inputs.

Score composition (0-100)
-------------------------
A — Historical Drawdown-Recovery                        max 45 pt
    A1 recovery success rate  (drawdowns fully recovered)    25 pt
    A2 median recovery velocity  (days to +50% of drawdown)  20 pt

B — Crisis Behavior vs Market                           max 30 pt
    B1 asymmetric beta  (beta_up  -  beta_down)              30 pt

C — Upside Capacity                                     max 25 pt
    C1 distance from 52-week high                            10 pt
    C2 fraction of positive quarters (last 8, ≥ +5%)         15 pt

If a component cannot be computed for lack of data, its points contribute
zero and the payload flags it via ``status``. Missing components should
reduce the confidence of the final score, not silently inflate it.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Iterable, Sequence

log = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────

# Minimum bars needed for each computation. Below these the sub-score is
# marked "insufficient_history" and contributes 0 pt.
MIN_BARS_RECOVERY = 250          # ~1 trading year — need drawdown events
MIN_BARS_ASYMMETRIC_BETA = 120   # ~6 months of aligned returns
MIN_BARS_52W = 200               # ~10 months to approximate 52-week high
MIN_BARS_QUARTERS = 8 * 63       # 8 quarters × 63 trading days ≈ 500 bars

# Drawdown detection thresholds
DRAWDOWN_ENTRY_PCT = -10.0       # peak → trough drop that qualifies as event
DRAWDOWN_RECOVERY_LOOKAHEAD = 180  # trading days to observe recovery after trough
DRAWDOWN_HALF_RECOVERY_PCT = 50.0  # half-way back to peak = "partial recovery"

# Weighting caps
CAP_A1 = 25.0
CAP_A2 = 20.0
CAP_B1 = 30.0
CAP_C1 = 10.0
CAP_C2 = 15.0

# Quarter length in trading days (approx.)
QUARTER_TRADING_DAYS = 63

# Positive quarter threshold (fraction, not pct) — a quarter must close
# at least +5% to count as "positive growth" for C2.
POSITIVE_QUARTER_MIN_RETURN = 0.05


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ResilienceComponent:
    """One sub-block of the Resilience Score."""
    score: float
    max_score: float
    status: str  # "ok" | "insufficient_history" | "no_data"
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": round(self.score, 1),
            "max": self.max_score,
            "status": self.status,
            **self.detail,
        }


@dataclass
class ResilienceScorePayload:
    ticker: str
    as_of: str | None
    score: float
    max_score: float
    status: str
    historical_recovery: ResilienceComponent
    asymmetric_beta: ResilienceComponent
    upside_capacity: ResilienceComponent

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "as_of": self.as_of,
            "resilience_score": round(self.score, 1),
            "max_score": self.max_score,
            "status": self.status,
            "components": {
                "historical_recovery": self.historical_recovery.to_dict(),
                "asymmetric_beta": self.asymmetric_beta.to_dict(),
                "upside_capacity": self.upside_capacity.to_dict(),
            },
        }


# ── Helpers ──────────────────────────────────────────────────────────────────


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _daily_returns(closes: Sequence[float]) -> list[float]:
    """Simple daily returns; skips non-positive or non-finite entries."""
    out: list[float] = []
    prev: float | None = None
    for c in closes:
        try:
            v = float(c)
        except (TypeError, ValueError):
            v = float("nan")
        if v <= 0 or v != v:  # 0/neg/NaN
            prev = None
            continue
        if prev is None or prev <= 0:
            prev = v
            continue
        out.append((v - prev) / prev)
        prev = v
    return out


# ── A — Historical Drawdown-Recovery ─────────────────────────────────────────


def _find_drawdown_events(
    closes: Sequence[float],
    entry_pct: float = DRAWDOWN_ENTRY_PCT,
) -> list[tuple[int, int]]:
    """Return list of (peak_idx, trough_idx) pairs where drawdown ≥ entry_pct.

    Peaks are running-max points; a drawdown event is closed when a lower
    trough is observed and price then reverses upward (i.e. next bar closes
    higher than trough).  Events do not overlap: after one is recorded we
    resume peak tracking from the trough onward.
    """
    events: list[tuple[int, int]] = []
    n = len(closes)
    if n < 2:
        return events

    peak_idx = 0
    peak_val = float(closes[0])
    trough_idx = 0
    trough_val = peak_val
    in_dd = False

    for i in range(1, n):
        c = float(closes[i])
        if not in_dd:
            if c >= peak_val:
                peak_idx = i
                peak_val = c
                trough_idx = i
                trough_val = c
                continue
            dd_pct = (c / peak_val - 1.0) * 100.0
            if dd_pct <= entry_pct:
                in_dd = True
                trough_idx = i
                trough_val = c
            continue

        # inside a drawdown: track new trough, close event on reversal
        if c < trough_val:
            trough_idx = i
            trough_val = c
            continue
        # reversal candle after trough
        if c > trough_val:
            events.append((peak_idx, trough_idx))
            peak_idx = trough_idx
            peak_val = trough_val
            in_dd = False
            # let subsequent bars re-establish a new peak

    # Handle open drawdown at end of series — count only if trough is meaningful
    if in_dd and (trough_val / peak_val - 1.0) * 100.0 <= entry_pct:
        events.append((peak_idx, trough_idx))

    return events


def _classify_recovery(
    closes: Sequence[float],
    peak_idx: int,
    trough_idx: int,
    lookahead: int = DRAWDOWN_RECOVERY_LOOKAHEAD,
) -> dict[str, Any]:
    """Given a drawdown event, return recovery statistics within lookahead."""
    peak = float(closes[peak_idx])
    trough = float(closes[trough_idx])
    half_target = trough + (peak - trough) * (DRAWDOWN_HALF_RECOVERY_PCT / 100.0)

    end_idx = min(len(closes) - 1, trough_idx + lookahead)
    days_to_half: int | None = None
    days_to_full: int | None = None
    max_after = trough
    for i in range(trough_idx + 1, end_idx + 1):
        v = float(closes[i])
        if v > max_after:
            max_after = v
        if days_to_half is None and v >= half_target:
            days_to_half = i - trough_idx
        if days_to_full is None and v >= peak:
            days_to_full = i - trough_idx
            break

    return {
        "peak_idx": peak_idx,
        "trough_idx": trough_idx,
        "drawdown_pct": round((trough / peak - 1.0) * 100.0, 2),
        "days_to_half_recovery": days_to_half,
        "days_to_full_recovery": days_to_full,
        "recovered_full": days_to_full is not None,
        "peak_before_pct_recovered": round((max_after / peak - 1.0) * 100.0, 2),
    }


def compute_historical_recovery(closes: Sequence[float]) -> ResilienceComponent:
    """Block A: recovery rate & velocity from past drawdown-recovery pairs."""
    if not closes:
        return ResilienceComponent(0.0, CAP_A1 + CAP_A2, "no_data")
    if len(closes) < MIN_BARS_RECOVERY:
        return ResilienceComponent(
            0.0,
            CAP_A1 + CAP_A2,
            "insufficient_history",
            {"bars": len(closes), "min_bars": MIN_BARS_RECOVERY},
        )

    events = _find_drawdown_events(closes)
    if not events:
        # No drawdowns ≥ threshold in the window: this is *itself* a signal
        # of stability, but not evidence of "recovery capacity". Give a
        # neutral half-credit and flag it in the detail.
        return ResilienceComponent(
            (CAP_A1 + CAP_A2) * 0.5,
            CAP_A1 + CAP_A2,
            "ok",
            {
                "drawdown_events": 0,
                "note": "no_drawdowns_in_window",
                "success_rate_pct": None,
                "median_recovery_days": None,
            },
        )

    recoveries = [_classify_recovery(closes, p, t) for p, t in events]

    # A1 — success rate: fraction that fully recovered within lookahead
    full_recoveries = sum(1 for r in recoveries if r["recovered_full"])
    success_rate = full_recoveries / len(recoveries)  # 0..1
    a1 = success_rate * CAP_A1

    # A2 — median velocity: days to 50% recovery (partial); shorter = better
    half_days = [r["days_to_half_recovery"] for r in recoveries if r["days_to_half_recovery"] is not None]
    if half_days:
        median_half = median(half_days)
        # Map 5 days → full 20pt, 60+ days → 0pt (linear).
        a2 = _clamp((60 - median_half) / (60 - 5) * CAP_A2, 0, CAP_A2)
    else:
        median_half = None
        a2 = 0.0

    return ResilienceComponent(
        a1 + a2,
        CAP_A1 + CAP_A2,
        "ok",
        {
            "drawdown_events": len(recoveries),
            "full_recoveries": full_recoveries,
            "success_rate_pct": round(success_rate * 100.0, 1),
            "median_recovery_days": median_half,
            "a1_pt": round(a1, 1),
            "a2_pt": round(a2, 1),
        },
    )


# ── B — Asymmetric Beta ──────────────────────────────────────────────────────


def _split_beta(ticker_ret: Sequence[float], bench_ret: Sequence[float]) -> dict[str, Any]:
    """Compute beta_down (bench < 0) and beta_up (bench > 0) with OLS."""
    down_t, down_b = [], []
    up_t, up_b = [], []
    for tr, br in zip(ticker_ret, bench_ret):
        if br < 0:
            down_t.append(tr)
            down_b.append(br)
        elif br > 0:
            up_t.append(tr)
            up_b.append(br)

    def _beta(x: list[float], y: list[float]) -> float | None:
        n = len(x)
        if n < 20:
            return None
        mx = sum(x) / n
        my = sum(y) / n
        num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
        den = sum((xi - mx) ** 2 for xi in x)
        if den == 0:
            return None
        return num / den

    return {
        "beta_down": _beta(down_b, down_t),
        "beta_up": _beta(up_b, up_t),
        "n_down": len(down_t),
        "n_up": len(up_t),
    }


def compute_asymmetric_beta(
    ticker_closes: Sequence[float],
    xbi_closes: Sequence[float],
) -> ResilienceComponent:
    """Block B: β_up − β_down. Resilient stocks capture upside, avoid downside."""
    if not ticker_closes or not xbi_closes:
        return ResilienceComponent(0.0, CAP_B1, "no_data")

    n = min(len(ticker_closes), len(xbi_closes))
    if n < MIN_BARS_ASYMMETRIC_BETA:
        return ResilienceComponent(
            0.0, CAP_B1, "insufficient_history",
            {"bars": n, "min_bars": MIN_BARS_ASYMMETRIC_BETA},
        )

    # Align tail-first (both series are chronological with `closes[-1]` = latest)
    tr = _daily_returns(ticker_closes[-n:])
    br = _daily_returns(xbi_closes[-n:])
    m = min(len(tr), len(br))
    if m < MIN_BARS_ASYMMETRIC_BETA - 20:
        return ResilienceComponent(
            0.0, CAP_B1, "insufficient_history",
            {"aligned_bars": m, "min_bars": MIN_BARS_ASYMMETRIC_BETA - 20},
        )

    tr = tr[-m:]
    br = br[-m:]
    b = _split_beta(tr, br)
    beta_down = b["beta_down"]
    beta_up = b["beta_up"]

    if beta_down is None or beta_up is None:
        return ResilienceComponent(
            0.0, CAP_B1, "insufficient_history",
            {"beta_down": beta_down, "beta_up": beta_up, **b},
        )

    asymmetry = beta_up - beta_down  # positive = resilient, negative = fragile
    # Map asymmetry range [-1.0, +1.0] → [0, 30] pt (linear, clamped).
    # Neutral (β_up = β_down, i.e. symmetric response) → 15 pt, the midpoint.
    # Fully resilient (e.g. β_up=1.5, β_down=0.5) → 30 pt.
    # Fully fragile   (e.g. β_up=0.5, β_down=1.5) → 0 pt.
    score = _clamp((asymmetry + 1.0) / 2.0 * CAP_B1, 0, CAP_B1)

    return ResilienceComponent(
        score, CAP_B1, "ok",
        {
            "beta_down": round(beta_down, 3),
            "beta_up": round(beta_up, 3),
            "asymmetry": round(asymmetry, 3),
            "n_down": b["n_down"],
            "n_up": b["n_up"],
        },
    )


# ── C — Upside Capacity ──────────────────────────────────────────────────────


def _pct_from_52w_high(closes: Sequence[float]) -> float | None:
    if len(closes) < MIN_BARS_52W:
        return None
    window = closes[-252:] if len(closes) >= 252 else closes
    hi = max(float(c) for c in window if float(c) > 0)
    if hi <= 0:
        return None
    now = float(closes[-1])
    if now <= 0:
        return None
    return (1.0 - now / hi) * 100.0  # 0 at high, +100 at zero


def _positive_quarter_fraction(closes: Sequence[float]) -> tuple[float | None, int]:
    if len(closes) < MIN_BARS_QUARTERS:
        return None, 0
    # Grab last 8 quarters ending at latest close
    quarters = 8
    q_len = QUARTER_TRADING_DAYS
    start = len(closes) - quarters * q_len
    if start < 0:
        return None, 0
    positives = 0
    evaluated = 0
    for q in range(quarters):
        i0 = start + q * q_len
        i1 = i0 + q_len - 1
        c0 = float(closes[i0])
        c1 = float(closes[i1])
        if c0 <= 0 or c1 <= 0:
            continue
        evaluated += 1
        if (c1 / c0 - 1.0) >= POSITIVE_QUARTER_MIN_RETURN:
            positives += 1
    if evaluated == 0:
        return None, 0
    return positives / evaluated, evaluated


def compute_upside_capacity(closes: Sequence[float]) -> ResilienceComponent:
    """Block C: distance from 52w high + positive-quarter frequency."""
    if not closes:
        return ResilienceComponent(0.0, CAP_C1 + CAP_C2, "no_data")

    pct52 = _pct_from_52w_high(closes)
    posq_frac, posq_evaluated = _positive_quarter_fraction(closes)

    if pct52 is None and posq_frac is None:
        return ResilienceComponent(
            0.0, CAP_C1 + CAP_C2, "insufficient_history",
            {"bars": len(closes)},
        )

    # C1: 0% from high → 0 pt, 60%+ from high → 10 pt (linear, clamped).
    c1 = _clamp((pct52 or 0.0) / 60.0 * CAP_C1, 0, CAP_C1) if pct52 is not None else 0.0
    # C2: fraction of positive quarters × 15
    c2 = (posq_frac or 0.0) * CAP_C2 if posq_frac is not None else 0.0

    return ResilienceComponent(
        c1 + c2,
        CAP_C1 + CAP_C2,
        "ok",
        {
            "pct_from_52w_high": round(pct52, 2) if pct52 is not None else None,
            "positive_quarters_frac": round(posq_frac, 3) if posq_frac is not None else None,
            "positive_quarters_evaluated": posq_evaluated,
            "c1_pt": round(c1, 1),
            "c2_pt": round(c2, 1),
        },
    )


# ── Aggregate ────────────────────────────────────────────────────────────────


def compute_resilience_score(
    ticker: str,
    closes: Sequence[float],
    xbi_closes: Sequence[float],
    as_of: str | None = None,
) -> ResilienceScorePayload:
    """Full 0-100 Resilience Score with per-block breakdown."""
    a = compute_historical_recovery(closes)
    b = compute_asymmetric_beta(closes, xbi_closes)
    c = compute_upside_capacity(closes)
    total = a.score + b.score + c.score
    max_total = CAP_A1 + CAP_A2 + CAP_B1 + CAP_C1 + CAP_C2

    # If EVERY component is unavailable, mark the payload as unmeasurable.
    if a.status != "ok" and b.status != "ok" and c.status != "ok":
        status = "insufficient_history"
    else:
        status = "ok"

    return ResilienceScorePayload(
        ticker=ticker.upper(),
        as_of=as_of,
        score=total,
        max_score=max_total,
        status=status,
        historical_recovery=a,
        asymmetric_beta=b,
        upside_capacity=c,
    )


# ── Snapshot writer / reader ─────────────────────────────────────────────────
#
# The endpoint is served from a pre-computed JSON snapshot on disk (see
# learning_lab_overview_snapshot pattern) so that a slow full recompute
# NEVER runs on the request path.

_SNAPSHOT_MTIME_CACHE: tuple[float, dict[str, Any]] | None = None


def _default_snapshot_path() -> Path:
    from orchestrator_io_paths import RESILIENCE_SCORES_SNAPSHOT_JSON
    return Path(RESILIENCE_SCORES_SNAPSHOT_JSON)


def build_resilience_scores_payload(tickers: Iterable[str]) -> dict[str, Any]:
    """Compute resilience score for every ticker in ``tickers``.

    Loads each ticker's 5-year daily closes via ``ensure_price_series`` and
    XBI's closes via ``ensure_xbi_closes``. XBI is loaded once and reused.
    """
    from prediction.scoring_data import ensure_price_series, ensure_xbi_closes

    try:
        xbi = ensure_xbi_closes(min_bars=90)
    except Exception as exc:
        log.warning("resilience_score: failed to load XBI series: %s", exc)
        xbi = []

    entries: dict[str, dict[str, Any]] = {}
    skipped: list[str] = []
    tickers = list({t.upper().strip() for t in tickers if t})

    for tk in tickers:
        try:
            closes, _ = ensure_price_series(tk, min_bars=126, persist=False)
        except Exception as exc:
            log.warning("resilience_score: %s price load failed: %s", tk, exc)
            skipped.append(tk)
            continue
        if not closes:
            skipped.append(tk)
            continue
        payload = compute_resilience_score(tk, closes, xbi)
        entries[tk] = payload.to_dict()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ticker_count": len(entries),
        "skipped_count": len(skipped),
        "skipped": sorted(skipped),
        "entries": entries,
    }


def write_resilience_scores_snapshot(
    tickers: Iterable[str],
    path: str | Path | None = None,
) -> dict[str, Any]:
    """Compute the snapshot for ``tickers`` and persist atomically.

    Called by the orchestrator after ``write_investment_sim_outcomes()``.
    Uses temp-file + rename so a concurrent reader never sees a half-written
    JSON. Primes the mtime cache for the next request.
    """
    global _SNAPSHOT_MTIME_CACHE
    payload = build_resilience_scores_payload(tickers)
    out = Path(path) if path is not None else _default_snapshot_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    tmp.replace(out)
    try:
        _SNAPSHOT_MTIME_CACHE = (out.stat().st_mtime, payload)
    except OSError:
        _SNAPSHOT_MTIME_CACHE = None
    log.info(
        "resilience_score snapshot written: %d tickers, %d skipped → %s",
        payload.get("ticker_count", 0),
        payload.get("skipped_count", 0),
        out,
    )
    return payload


def read_resilience_scores_snapshot(
    path: str | Path | None = None,
) -> dict[str, Any] | None:
    """Return parsed snapshot, or None if missing/unreadable.

    Uses mtime-keyed in-process cache: reparse only when the file on disk
    has changed. Called by the FastAPI endpoint on every request.
    """
    global _SNAPSHOT_MTIME_CACHE
    p = Path(path) if path is not None else _default_snapshot_path()
    if not p.exists():
        return None
    try:
        current_mtime = p.stat().st_mtime
    except OSError:
        return None
    if _SNAPSHOT_MTIME_CACHE and _SNAPSHOT_MTIME_CACHE[0] == current_mtime:
        return _SNAPSHOT_MTIME_CACHE[1]
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("resilience_score: failed to parse snapshot %s: %s", p, exc)
        return None
    _SNAPSHOT_MTIME_CACHE = (current_mtime, payload)
    return payload


def invalidate_resilience_scores_cache() -> None:
    """Drop the in-process mtime cache (e.g. after a hot-refresh)."""
    global _SNAPSHOT_MTIME_CACHE
    _SNAPSHOT_MTIME_CACHE = None
