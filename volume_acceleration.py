"""
Volume acceleration (RVOL log-slope) for SuperNova Soft BUY High Vol.

Detects anomalous incremental-volume acceleration on listed names, robust to:
  - intraday U-shape seasonality (open/close high, midday low)
  - micro/small-cap noise
  - isolated prints / block trades
  - the arithmetic fact that CUMULATIVE volume always decelerates toward 1

Method (the "volume doubles every 30 min" idea, made continuous):

  1. Incremental volume per fixed time bucket (not cumulative).
  2. RVOL: bucket / median of the same clock bucket over N prior trading days.
  3. Rolling log-linear fit of ln(rvol) vs minutes → T_double = ln(2) / beta.
  4. Robustness: dollar-volume floor, min R², consecutive-bucket confirm,
     optional concomitant price move.

Typical use: ``fetch_volume_acceleration(tickers)`` after a cheap
VOL-vs-prev-session surge pre-filter (≥150%).
"""
from __future__ import annotations

import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timezone
from typing import Any, Optional, Sequence

import numpy as np
import pandas as pd

logger = logging.getLogger("supernova.volume_accel")

try:
    from zoneinfo import ZoneInfo

    NY = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    NY = timezone.utc  # type: ignore[assignment]

_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")
_CACHE: dict[str, Any] = {"at": 0.0, "key": "", "payload": None}
_CACHE_TTL_S = 3 * 60
_MAX_TICKERS = 20


@dataclass
class VolumeAccelConfig:
    bucket_minutes: int = 5
    regression_window_buckets: int = 6
    rvol_lookback_days: int = 20
    # Biotech small-caps: Claude's $250k/bucket is too high for this universe.
    min_dollar_volume: float = 50_000.0
    min_r_squared: float = 0.6
    confirm_buckets: int = 2
    doubling_time_alert_minutes: float = 30.0
    price_weight: bool = True
    price_move_floor_pct: float = 0.5


@dataclass
class VolumeAccelResult:
    ticker: str
    timestamp: pd.Timestamp
    rvol: float
    beta: float
    doubling_time_minutes: Optional[float]
    r_squared: float
    confirmed: bool
    price_move_pct: float
    score: float
    flagged: bool

    def to_json(self) -> dict[str, Any]:
        ts = self.timestamp
        iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        return {
            "ticker": self.ticker,
            "timestamp": iso,
            "rvol": None if self.rvol != self.rvol else round(float(self.rvol), 3),
            "beta": round(float(self.beta), 6),
            "doubling_time_minutes": (
                None
                if self.doubling_time_minutes is None
                else round(float(self.doubling_time_minutes), 1)
            ),
            "r_squared": round(float(self.r_squared), 3),
            "confirmed": bool(self.confirmed),
            "price_move_pct": round(float(self.price_move_pct), 3),
            "score": round(float(self.score), 5),
            "flagged": bool(self.flagged),
        }


def resample_incremental_volume(bars: pd.DataFrame, bucket_minutes: int) -> pd.DataFrame:
    df = bars.set_index("timestamp").sort_index()
    resampled = df.resample(f"{bucket_minutes}min").agg(
        volume=("volume", "sum"),
        close=("close", "last"),
    )
    resampled = resampled.dropna(subset=["close"])
    return resampled.reset_index()


def _tod_key(ts) -> str:
    """Clock bucket 'HH:MM' — comparable across naive/aware timestamps."""
    if hasattr(ts, "to_pydatetime"):
        ts = ts.to_pydatetime()
    if getattr(ts, "tzinfo", None) is not None:
        ts = ts.astimezone(NY)
    return f"{ts.hour:02d}:{ts.minute:02d}"


def build_seasonal_baseline(history: pd.DataFrame, lookback_days: int) -> pd.Series:
    h = history.copy()
    h["date"] = h["timestamp"].dt.date
    h["tod"] = h["timestamp"].map(_tod_key)
    recent_dates = sorted(h["date"].unique())[-lookback_days:]
    h = h[h["date"].isin(recent_dates)]
    if h.empty:
        return pd.Series(dtype=float)
    return h.groupby("tod")["volume"].median()


def rvol(bucket_volume: float, tod: str | dt_time, baseline: pd.Series) -> float:
    key = tod if isinstance(tod, str) else f"{tod.hour:02d}:{tod.minute:02d}"
    try:
        base = baseline.loc[key] if key in baseline.index else float("nan")
    except Exception:
        base = float("nan")
    if base is None or (isinstance(base, float) and (base != base or base <= 0)):
        return float("nan")
    return float(bucket_volume) / float(base)


def rolling_log_slope(
    rvol_series: Sequence[float], bucket_minutes: int
) -> tuple[float, float]:
    values = np.asarray(rvol_series, dtype=float)
    values = values[~np.isnan(values)]
    n = len(values)
    if n < 3:
        return 0.0, 0.0
    values = np.clip(values, 1e-6, None)
    log_v = np.log(values)
    t = np.arange(n) * bucket_minutes
    t_mean = t.mean()
    log_v_mean = log_v.mean()
    denom = np.sum((t - t_mean) ** 2)
    if denom == 0:
        return 0.0, 0.0
    beta = float(np.sum((t - t_mean) * (log_v - log_v_mean)) / denom)
    alpha = log_v_mean - beta * t_mean
    pred = alpha + beta * t
    ss_res = float(np.sum((log_v - pred) ** 2))
    ss_tot = float(np.sum((log_v - log_v_mean) ** 2))
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return beta, float(r_squared)


def doubling_time_from_beta(beta: float) -> Optional[float]:
    if beta <= 0:
        return None
    return math.log(2) / beta


def compute_volume_acceleration_score(
    ticker: str,
    bucketed: pd.DataFrame,
    baseline: pd.Series,
    config: VolumeAccelConfig | None = None,
) -> list[VolumeAccelResult]:
    cfg = config or VolumeAccelConfig()
    win = cfg.regression_window_buckets
    if bucketed.empty or win < 3:
        return []

    rvols = [
        rvol(float(row["volume"]), _tod_key(row["timestamp"]), baseline)
        for _, row in bucketed.iterrows()
    ]
    bucketed = bucketed.assign(rvol=rvols)
    dollar_volume = bucketed["volume"] * bucketed["close"]

    results: list[VolumeAccelResult] = []
    flagged_streak = 0

    for i in range(win - 1, len(bucketed)):
        window = bucketed.iloc[i - win + 1 : i + 1]
        beta, r2 = rolling_log_slope(window["rvol"].tolist(), cfg.bucket_minutes)
        t_double = doubling_time_from_beta(beta)

        row = bucketed.iloc[i]
        window_start_close = float(bucketed.iloc[i - win + 1]["close"])
        price_move_pct = (
            (float(row["close"]) / window_start_close - 1.0) * 100.0
            if window_start_close
            else 0.0
        )

        passes_floor = float(dollar_volume.iloc[i]) >= cfg.min_dollar_volume
        passes_fit_quality = r2 >= cfg.min_r_squared
        passes_speed = (t_double is not None) and (
            t_double <= cfg.doubling_time_alert_minutes
        )
        passes_price = (not cfg.price_weight) or (
            abs(price_move_pct) >= cfg.price_move_floor_pct
        )

        raw_flag = passes_floor and passes_fit_quality and passes_speed and passes_price
        flagged_streak = flagged_streak + 1 if raw_flag else 0
        confirmed = flagged_streak >= cfg.confirm_buckets

        speed_component = (1.0 / t_double) if t_double else 0.0
        score = speed_component * r2
        if cfg.price_weight:
            score *= max(abs(price_move_pct), 0.01)

        rvol_now = float(row["rvol"]) if row["rvol"] == row["rvol"] else float("nan")
        results.append(
            VolumeAccelResult(
                ticker=ticker,
                timestamp=row["timestamp"],
                rvol=rvol_now,
                beta=beta,
                doubling_time_minutes=t_double,
                r_squared=r2,
                confirmed=confirmed,
                price_move_pct=price_move_pct,
                score=score,
                flagged=confirmed,
            )
        )

    return results


def _normalize_tickers(raw: list[str] | str) -> list[str]:
    parts = raw.replace(";", ",").split(",") if isinstance(raw, str) else list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        t = str(p or "").strip().upper()
        if not t or t in seen or "TOTALE" in t or not _TICKER_RE.match(t):
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= _MAX_TICKERS:
            break
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _extract_series(raw, ticker: str, field: str):
    if hasattr(raw.columns, "nlevels") and raw.columns.nlevels > 1:
        if (field, ticker) in raw.columns:
            return raw[(field, ticker)]
        if (ticker, field) in raw.columns:
            return raw[(ticker, field)]
        try:
            return raw[field][ticker]
        except Exception:
            return None
    return raw[field] if field in raw.columns else None


def _bars_from_yahoo(raw, ticker: str) -> pd.DataFrame:
    close = _extract_series(raw, ticker, "Close")
    vol = _extract_series(raw, ticker, "Volume")
    if close is None or vol is None:
        return pd.DataFrame(columns=["timestamp", "close", "volume"])
    df = pd.DataFrame({"close": close, "volume": vol})
    df = df.dropna(subset=["close"])
    if df.empty:
        return pd.DataFrame(columns=["timestamp", "close", "volume"])
    idx = df.index
    if getattr(idx, "tz", None) is None:
        ts = pd.to_datetime(idx, utc=True).tz_convert(NY)
    else:
        ts = pd.to_datetime(idx).tz_convert(NY)
    df = df.assign(timestamp=ts)
    # Regular hours only — overnight prints would fake RVOL.
    minutes = df["timestamp"].dt.hour * 60 + df["timestamp"].dt.minute
    df = df[(minutes >= 9 * 60 + 30) & (minutes < 16 * 60)]
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"])
    return df[["timestamp", "close", "volume"]].reset_index(drop=True)


def _latest_result(results: list[VolumeAccelResult]) -> VolumeAccelResult | None:
    if not results:
        return None
    flagged = [r for r in results if r.flagged]
    if flagged:
        return flagged[-1]
    return results[-1]


def score_ticker_bars(
    ticker: str,
    bars: pd.DataFrame,
    *,
    config: VolumeAccelConfig | None = None,
    today: datetime | None = None,
) -> VolumeAccelResult | None:
    """Split history vs today, score the live session. ``bars`` already 5m incremental."""
    cfg = config or VolumeAccelConfig()
    if bars.empty:
        return None
    now = today or datetime.now(tz=NY)
    today_d = now.date()
    ts = bars["timestamp"]
    if getattr(ts.dt, "tz", None) is None:
        bars = bars.assign(timestamp=pd.to_datetime(ts, utc=True).dt.tz_convert(NY))
    hist = bars[bars["timestamp"].dt.date < today_d]
    live = bars[bars["timestamp"].dt.date == today_d]
    if live.empty:
        # Pre-open / weekend: last session as live, prior days as baseline.
        dates = sorted(bars["timestamp"].dt.date.unique())
        if not dates:
            return None
        last = dates[-1]
        live = bars[bars["timestamp"].dt.date == last]
        hist = bars[bars["timestamp"].dt.date < last]
    if live.empty or hist.empty:
        return None
    baseline = build_seasonal_baseline(hist, cfg.rvol_lookback_days)
    if baseline.empty:
        return None
    results = compute_volume_acceleration_score(ticker, live, baseline, cfg)
    return _latest_result(results)


def fetch_volume_acceleration(
    tickers: list[str] | str,
    *,
    force: bool = False,
    config: VolumeAccelConfig | None = None,
) -> dict[str, Any]:
    """Yahoo 5m bars → latest VolumeAccelResult per ticker (cached ~3 min)."""
    tks = _normalize_tickers(tickers)
    cfg = config or VolumeAccelConfig()
    cache_key = ",".join(tks)
    now = time.time()
    if (
        not force
        and _CACHE.get("payload") is not None
        and _CACHE.get("key") == cache_key
        and now - float(_CACHE.get("at") or 0) < _CACHE_TTL_S
    ):
        return _CACHE["payload"]  # type: ignore[return-value]

    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "config": {
            "bucket_minutes": cfg.bucket_minutes,
            "doubling_time_alert_minutes": cfg.doubling_time_alert_minutes,
            "min_dollar_volume": cfg.min_dollar_volume,
        },
    }
    if not tks:
        return payload

    try:
        import yfinance as yf
    except ImportError:
        payload["error"] = "yfinance_not_installed"
        return payload

    # 5m bars: Yahoo allows up to ~60d. 1mo covers the 20-day RVOL lookback.
    try:
        raw = yf.download(
            tks,
            period="1mo",
            interval="5m",
            auto_adjust=True,
            progress=False,
            threads=True,
            group_by="column",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("yf.download 5m volume accel failed: %s", exc)
        payload["error"] = str(exc)[:200]
        return payload

    if raw is None or (hasattr(raw, "empty") and raw.empty):
        payload["error"] = "empty"
        return payload

    rows: dict[str, Any] = {}
    for tk in tks:
        try:
            bars = _bars_from_yahoo(raw, tk)
            if bars.empty:
                continue
            # Already 5m from Yahoo — no further resample needed.
            result = score_ticker_bars(tk, bars, config=cfg)
            if result is None:
                continue
            rows[tk] = result.to_json()
        except Exception as exc:  # noqa: BLE001
            logger.debug("volume accel %s: %s", tk, exc)

    payload["rows"] = rows
    _CACHE.update({"at": now, "key": cache_key, "payload": payload})
    return payload
