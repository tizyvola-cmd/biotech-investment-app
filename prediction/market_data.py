"""
Market data helpers for prediction (yfinance / Yahoo raw frames).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

from prediction.errors import log_prediction_error

logger = logging.getLogger(__name__)


@dataclass
class OptionsSignalsResult:
    """Structured options fetch result (never silent empty without reason)."""

    signals: dict
    ok: bool
    error: str | None = None

    def get(self, key: str, default=None):
        return self.signals.get(key, default)

    def __bool__(self) -> bool:
        return self.ok and bool(self.signals)


def _index_to_dates(ser: pd.Series) -> pd.Series:
    try:
        ser = ser.copy()
        ser.index = pd.Index(
            [x.date() if hasattr(x, "date") else x for x in ser.index]
        )
    except Exception as exc:
        log_prediction_error("_index_to_dates", exc)
    return ser


def _strip_to_1d_float_series(obj) -> pd.Series:
    """Da colonna yfinance (Series o DataFrame 1 riga/cols) → Series float 1D."""
    if obj is None:
        return pd.Series(dtype=float)
    x = obj
    if isinstance(x, pd.DataFrame):
        if x.empty or x.shape[1] < 1:
            return pd.Series(dtype=float)
        x = x.iloc[:, 0]
    try:
        return pd.Series(x, copy=False).astype(float).dropna()
    except Exception as exc:
        log_prediction_error("_strip_to_1d_float_series", exc)
        return pd.Series(dtype=float)


def options_signals(ticker: str, curr_price: float) -> OptionsSignalsResult:
    """
    Scarica la prima scadenza disponibile e ritorna:
      pcr          — put/call volume ratio
      exp_move_pct — (straddle ATM / curr_price) * 100

    Ritorna ``OptionsSignalsResult`` con ``ok=False`` e ``error`` su fallimento
    (log WARNING), mai dict vuoto silenzioso.
    """
    if curr_price <= 0:
        msg = "prezzo corrente non valido"
        logger.warning("options_signals %s: %s", ticker, msg)
        return OptionsSignalsResult({}, ok=False, error=msg)

    try:
        import yfinance as yf

        t = yf.Ticker(ticker)
        exps = t.options
        if not exps:
            msg = "nessuna scadenza opzioni"
            logger.warning("options_signals %s: %s", ticker, msg)
            return OptionsSignalsResult({}, ok=False, error=msg)
        chain = t.option_chain(exps[0])
        calls = chain.calls.copy()
        puts = chain.puts.copy()

        cv = float(calls["volume"].fillna(0).sum())
        pv = float(puts["volume"].fillna(0).sum())
        pcr = round(pv / cv, 3) if cv > 0 else None

        exp_move_pct = None
        if not calls.empty:
            calls["_dist"] = (calls["strike"] - curr_price).abs()
            atm_strike = float(calls.sort_values("_dist").iloc[0]["strike"])
            atm_call_rows = calls[calls["strike"] == atm_strike]["lastPrice"]
            atm_put_rows = puts[puts["strike"] == atm_strike]["lastPrice"]
            atm_c = float(atm_call_rows.iloc[0]) if not atm_call_rows.empty else 0.0
            atm_p = float(atm_put_rows.iloc[0]) if not atm_put_rows.empty else 0.0
            straddle = atm_c + atm_p
            if straddle > 0:
                exp_move_pct = round(straddle / curr_price * 100, 1)

        signals = {
            k: v
            for k, v in {"pcr": pcr, "exp_move_pct": exp_move_pct}.items()
            if v is not None
        }
        if not signals:
            msg = "catena opzioni senza PCR né move ATM"
            logger.warning("options_signals %s: %s", ticker, msg)
            return OptionsSignalsResult({}, ok=False, error=msg)
        return OptionsSignalsResult(signals, ok=True, error=None)
    except Exception as exc:
        msg = str(exc) or type(exc).__name__
        logger.warning("options_signals %s: %s", ticker, msg)
        return OptionsSignalsResult({}, ok=False, error=msg)


def close_series_from_raw(raw_pd: pd.DataFrame, sym_u: str) -> pd.Series:
    """Estrae serie Close per un ticker (compat MultiIndex tipo (Close,TICK))."""
    if raw_pd is None or getattr(raw_pd, "empty", True):
        return pd.Series(dtype=float)
    cols = raw_pd.columns
    cand = None
    if isinstance(cols, pd.MultiIndex):
        for _name in (sym_u, sym_u.replace(".", "-")):
            _tup = ("Close", _name)
            try:
                if _tup in raw_pd.columns:
                    cand = raw_pd[_tup]
                    break
            except Exception as exc:
                log_prediction_error(f"close_series_from_raw:{sym_u}:column_lookup", exc)
        if cand is None:
            for tk in ("Close", "Adj Close"):
                if tk in cols.get_level_values(0):
                    try:
                        sub = raw_pd.xs(tk, axis=1, level=0, drop_level=False)
                        if isinstance(sub, pd.DataFrame):
                            if sym_u in sub.columns:
                                cand = sub[sym_u]
                            elif sub.shape[1] == 1:
                                cand = sub.iloc[:, 0]
                            else:
                                cand = sub.iloc[:, 0]
                        else:
                            cand = sub
                        break
                    except Exception as exc:
                        log_prediction_error(
                            f"close_series_from_raw:{sym_u}:multiindex_xs",
                            exc,
                        )
    if cand is None and "Close" in raw_pd.columns:
        cand = raw_pd["Close"]
    if cand is None:
        if raw_pd.shape[1] < 1:
            return pd.Series(dtype=float)
        cand = raw_pd.iloc[:, 0]
    out = _strip_to_1d_float_series(cand)
    return _index_to_dates(out) if not out.empty else out


__all__ = [
    "OptionsSignalsResult",
    "options_signals",
    "close_series_from_raw",
]
