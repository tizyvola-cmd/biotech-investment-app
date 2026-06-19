"""
Market context gate — sector regime from XBI / TLT / VIX.

Writes ``data/market_context.json``. Defaults to NEUTRAL when data unavailable
(never blocks entries solely due to fetch failure).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from orchestrator_io_paths import DATA_DIR, MARKET_CONTEXT_JSON

logger = logging.getLogger(__name__)

MarketRegime = Literal["RISK_ON", "NEUTRAL", "RISK_OFF", "CRISIS"]

THRESHOLDS: dict[str, float] = {
    "vix_crisis": 35.0,
    "xbi_5d_crisis_pct": -8.0,
    "xbi_5d_risk_off_pct": -3.0,
    "xbi_20d_risk_off_pct": -6.0,
    "tlt_5d_risk_off_pct": 1.0,
    "xbi_5d_risk_on_pct": 2.0,
    "xbi_20d_risk_on_pct": 3.0,
}

SYMBOLS = {
    "xbi": "XBI",
    "tlt": "TLT",
    "vix": "^VIX",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _pct_return(closes: list[float], days: int) -> float | None:
    if len(closes) < days + 1:
        return None
    old = closes[-(days + 1)]
    new = closes[-1]
    if old <= 0:
        return None
    return round((new - old) / old * 100.0, 4)


def _fetch_closes(symbol: str, sessions: int = 25) -> list[float]:
    try:
        import yfinance as yf
    except ImportError:
        return []
    try:
        hist = yf.Ticker(symbol).history(period="2mo", auto_adjust=True)
        if hist is None or hist.empty:
            return []
        closes = [float(v) for v in hist["Close"].dropna().tolist()]
        return closes[-sessions:] if len(closes) > sessions else closes
    except Exception as exc:
        logger.warning("[MarketContext] fetch %s failed: %s", symbol, exc)
        return []


def compute_regime_signals(
    *,
    xbi_closes: list[float] | None = None,
    tlt_closes: list[float] | None = None,
    vix_level: float | None = None,
) -> dict[str, Any]:
    """Compute metrics; fetch live data when series not supplied."""
    xbi = xbi_closes if xbi_closes is not None else _fetch_closes(SYMBOLS["xbi"])
    tlt = tlt_closes if tlt_closes is not None else _fetch_closes(SYMBOLS["tlt"])

    if vix_level is None:
        vix_series = _fetch_closes(SYMBOLS["vix"], sessions=5)
        vix_level = vix_series[-1] if vix_series else None

    xbi_5d = _pct_return(xbi, 5)
    xbi_20d = _pct_return(xbi, 20)
    tlt_5d = _pct_return(tlt, 5)

    return {
        "xbi_5d_return": xbi_5d,
        "xbi_20d_return": xbi_20d,
        "tlt_5d_return": tlt_5d,
        "vix_level": round(vix_level, 2) if vix_level is not None else None,
        "data_ok": bool(xbi and len(xbi) >= 6),
    }


def classify_regime(signals: dict[str, Any]) -> MarketRegime:
    """First-match rules; NEUTRAL when inputs missing."""
    vix = signals.get("vix_level")
    x5 = signals.get("xbi_5d_return")
    x20 = signals.get("xbi_20d_return")
    t5 = signals.get("tlt_5d_return")

    if vix is not None and float(vix) > THRESHOLDS["vix_crisis"]:
        return "CRISIS"
    if x5 is not None and float(x5) < THRESHOLDS["xbi_5d_crisis_pct"]:
        return "CRISIS"

    if x5 is not None and float(x5) < THRESHOLDS["xbi_5d_risk_off_pct"]:
        return "RISK_OFF"
    if (
        x20 is not None
        and float(x20) < THRESHOLDS["xbi_20d_risk_off_pct"]
        and t5 is not None
        and float(t5) > THRESHOLDS["tlt_5d_risk_off_pct"]
    ):
        return "RISK_OFF"

    if (
        x5 is not None
        and float(x5) > THRESHOLDS["xbi_5d_risk_on_pct"]
        and x20 is not None
        and float(x20) > THRESHOLDS["xbi_20d_risk_on_pct"]
    ):
        return "RISK_ON"

    return "NEUTRAL"


def regime_gate_reason(regime: MarketRegime, signals: dict[str, Any]) -> str:
    x5 = signals.get("xbi_5d_return")
    x20 = signals.get("xbi_20d_return")
    vix = signals.get("vix_level")
    if regime == "CRISIS":
        if vix is not None and float(vix) > THRESHOLDS["vix_crisis"]:
            return f"VIX {float(vix):.1f} — crisis volatility"
        if x5 is not None:
            return f"XBI {float(x5):+.1f}% over 5d — sector crash"
        return "Sector crisis conditions"
    if regime == "RISK_OFF":
        if x5 is not None:
            return f"XBI {float(x5):+.1f}% over 5d — sector risk-off"
        return "Sector risk-off (rates + biotech weakness)"
    if regime == "RISK_ON":
        return "Sector risk-on — biotech momentum supportive"
    return "Sector neutral — no macro gate"


# Precat kinds that count as "entry" before gating
_ENTRY_KINDS = frozenset({"enter", "accumulate"})
_WATCH_LIKE = frozenset({"too_early"})


def apply_regime_to_precat_kind(
    original_kind: str,
    regime: MarketRegime,
) -> tuple[str, bool, str | None]:
    """
    Map precat kind through regime gate.

    Returns (gated_kind, gate_fired, gate_reason_suffix).
    gated_kind uses ``hold`` for paused entries (not a precat kind natively).
    """
    ok = str(original_kind or "").strip().lower()
    if regime in ("RISK_ON", "NEUTRAL"):
        return ok or "avoid", False, None

    if regime == "RISK_OFF":
        if ok in _ENTRY_KINDS:
            return "hold", True, "entries paused (risk-off)"
        return ok or "avoid", False, None

    # CRISIS — degrade all non-exit signals
    if ok in ("sell",):
        return ok, False, None
    if ok in _ENTRY_KINDS or ok in _WATCH_LIKE or ok == "late":
        return "avoid", True, "all signals suspended (crisis)"
    if ok == "avoid":
        return "avoid", False, None
    return "hold", True, "watch suspended (crisis)"


def build_gate_payload(
    original_kind: str,
    regime: MarketRegime,
    signals: dict[str, Any],
) -> dict[str, Any]:
    gated, fired, suffix = apply_regime_to_precat_kind(original_kind, regime)
    base_reason = regime_gate_reason(regime, signals)
    reason = f"{base_reason} — {suffix}" if suffix else base_reason
    return {
        "market_regime": regime,
        "regime_gate_fired": fired,
        "original_signal": original_kind,
        "gated_signal": gated,
        "gate_reason": reason if fired else base_reason,
        "entry_allowed": regime in ("RISK_ON", "NEUTRAL") and gated in _ENTRY_KINDS,
        "watch_allowed": regime != "CRISIS",
    }


def load_market_context(path: Path | str | None = None) -> dict[str, Any]:
    p = Path(path or MARKET_CONTEXT_JSON)
    if not p.is_file():
        return {"regime": "NEUTRAL", "signals": {}, "history_7d": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"regime": "NEUTRAL", "signals": {}, "history_7d": []}


def save_market_context(doc: dict[str, Any], path: Path | str | None = None) -> Path:
    p = Path(path or MARKET_CONTEXT_JSON)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return p


def run(
    *,
    xbi_closes: list[float] | None = None,
    tlt_closes: list[float] | None = None,
    vix_level: float | None = None,
    path: Path | str | None = None,
) -> dict[str, Any]:
    """
    Fetch macro series, classify regime, persist ``market_context.json``.

    On fetch failure → NEUTRAL (never CRISIS/RISK_OFF from missing data).
    """
    signals = compute_regime_signals(
        xbi_closes=xbi_closes,
        tlt_closes=tlt_closes,
        vix_level=vix_level,
    )
    if not signals.get("data_ok"):
        logger.warning("[MarketContext] XBI data insufficient — defaulting to NEUTRAL")
        regime: MarketRegime = "NEUTRAL"
        signals["fallback"] = True
    else:
        regime = classify_regime(signals)
        signals["fallback"] = False

    prev = load_market_context(path)
    history = list(prev.get("history_7d") or [])
    history.append(
        {
            "ts": _now_iso(),
            "regime": regime,
            "xbi_5d_return": signals.get("xbi_5d_return"),
            "vix_level": signals.get("vix_level"),
        }
    )
    history = history[-7 * 4 :]

    doc = {
        "version": 1,
        "updated_at": _now_iso(),
        "regime": regime,
        "signals": signals,
        "gate_reason": regime_gate_reason(regime, signals),
        "history_7d": history,
    }
    out_path = save_market_context(doc, path)
    logger.info(
        "[MarketContext] regime=%s xbi_5d=%s vix=%s → %s",
        regime,
        signals.get("xbi_5d_return"),
        signals.get("vix_level"),
        out_path,
    )
    return doc


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    doc = run()
    print(json.dumps(doc, indent=2, ensure_ascii=False))
    sys.exit(0)
