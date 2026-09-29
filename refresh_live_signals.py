#!/usr/bin/env python3
"""
refresh_live_signals.py — Aggiornamento rapido segnali Decision Lab.

Scarica solo i prezzi recenti (~90gg) per le società con CD ≤ 90 giorni,
calcola slope/run_up/affid/pred5 e aggiorna direttamente
data/simulation_sheet_snapshot.json — senza toccare Excel né importare
data_orchestrator.

Tempo tipico: 15–30 secondi per ~25 ticker.

Uso:
    .venv\\Scripts\\python.exe refresh_live_signals.py
    .venv\\Scripts\\python.exe refresh_live_signals.py --dry-run
    .venv\\Scripts\\python.exe refresh_live_signals.py --cd-horizon 60
    .venv\\Scripts\\python.exe refresh_live_signals.py --force-prices

Fuori sessione regolare NYSE (weekend / festivi / pre-post market) riscrive
comunque Prezzo Corrente / Var. Giorn. % con la **chiusura ufficiale**
dell'ultima sessione (non tick pre/post-market), così una quote di metà
giornata non resta congelata overnight. Durante RTH usa i prezzi live.
``--force-prices`` / ``LIVE_SIGNALS_FORCE_PRICES=1`` forza la modalità live.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from us_equity_session import (
    last_regular_session_close,
    live_price_write_mode,
    should_write_live_prices,
)

# ── Paths ─────────────────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parent
_DATA = _ROOT / "data"
_SIM_SNAP = _DATA / "simulation_sheet_snapshot.json"
_PAST_JSON = _DATA / "past_catalyst_predictions.json"
_STATUS_FILE = _DATA / "refresh_live_signals_status.json"

# ── Parametri ─────────────────────────────────────────────────────────────────
DEFAULT_CD_HORIZON_DAYS = 90     # considera CD fino a N giorni da oggi
YF_PERIOD = "3mo"                # 3 mesi di prezzi per slope accurata
MIN_BARS_SLOPE5  = 5
MIN_BARS_SLOPE20 = 10
MIN_BARS_SLOPE45 = 5


# ─── Helpers prezzo ───────────────────────────────────────────────────────────

def _slope_n(prices: list[float], n: int) -> float | None:
    """Pendenza lineare (pp/giorno) sugli ultimi n prezzi, normalizzata su p[0]."""
    import numpy as np
    s = prices[-n:]
    if len(s) < max(3, n // 2):
        return None
    p0 = s[0] if s[0] > 0 else 1.0
    x = np.arange(len(s), dtype=float)
    y = [(p / p0 - 1.0) * 100.0 for p in s]
    return round(float(np.polyfit(x, y, 1)[0]), 4)


def _run_up(prices: list[float], n: int) -> float | None:
    """Variazione % cumulativa sugli ultimi n giorni."""
    if len(prices) < n:
        return None
    p0 = prices[-n]
    if p0 <= 0:
        return None
    return round((prices[-1] / p0 - 1.0) * 100.0, 2)


def _rsi14(prices: list[float]) -> float | None:
    """RSI a 14 periodi (semplificato, Wilder)."""
    if len(prices) < 15:
        return None
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    if len(gains) < 14:
        return None
    avg_g = sum(gains[-14:]) / 14
    avg_l = sum(losses[-14:]) / 14
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return round(100 - 100 / (1 + rs), 1)


def _vol_ratio(volumes: list[float]) -> float | None:
    """Volume recente (5g) / medio (20g)."""
    if len(volumes) < 20:
        return None
    avg20 = sum(volumes[-20:]) / 20
    avg5 = sum(volumes[-5:]) / 5
    return round(avg5 / avg20, 3) if avg20 > 0 else None


def _r2_linear(prices: list[float], n: int = 45) -> float | None:
    """R² di un fit lineare sugli ultimi n prezzi (stessa logica di data_orchestrator)."""
    import numpy as np
    s = prices[-n:]
    if len(s) < max(4, n // 3):
        return None
    p0 = s[0] if s[0] > 0 else 1.0
    x = np.arange(len(s), dtype=float)
    y = np.array([(p / p0 - 1.0) * 100.0 for p in s])
    try:
        coeffs = np.polyfit(x, y, 1)
        y_pred = np.polyval(coeffs, x)
        ss_res = float(np.sum((y - y_pred) ** 2))
        ss_tot = float(np.sum((y - y.mean()) ** 2))
        return round(1.0 - ss_res / ss_tot, 4) if ss_tot > 1e-12 else 0.0
    except Exception:
        return None


# ─── Affidabilità (stessa logica di data_orchestrator._affidabilita) ──────────

def _affidabilita(
    days_to_cd: int,
    vr: float | None,
    slope_20d: float | None,
    rsi: float | None,
    slope_5d: float | None,
    slope_aligned: bool | None = None,
    r2: float | None = None,
) -> int:
    base = (
        90 if days_to_cd <= 3  else
        78 if days_to_cd <= 7  else
        62 if days_to_cd <= 30 else
        48 if days_to_cd <= 60 else 35
    )
    adj = 0
    if vr is not None and vr >= 1.5:
        adj += 5
    eff_slope = slope_20d if slope_20d is not None else slope_5d
    if eff_slope is not None and eff_slope > 0:
        adj += 3
    if rsi is not None:
        if 30 <= rsi <= 70:
            adj += 3
        elif rsi > 70:
            adj -= 8
        elif rsi < 30:
            adj -= 5
    if slope_aligned is True:
        adj += 5
    elif slope_aligned is False:
        adj -= 5
    # R² regime: prezzo piatto pre-CD (r2 < 0.10) è neutro — non penalizzare
    # la quiete che precede un catalyst binario.
    if r2 is not None:
        if r2 >= 0.55 and eff_slope is not None and eff_slope > 0:
            adj += 5   # buon fit + momentum positivo
        elif r2 >= 0.45:
            pass       # fit accettabile: neutro
        elif r2 >= 0.25:
            adj -= 5   # fit debole
        elif r2 >= 0.10:
            adj -= 10  # fit scarso
        # r2 < 0.10 = prezzo piatto pre-CD: neutro
    return min(95, max(20, base + adj))


# ─── Pred5 empirica (mediana storica per direzione dal calibration) ────────────

def _load_pred_medians() -> dict[str, float]:
    """
    Mediana pred5 per direzione ('up'/'down') dai dati di calibrazione storici.
    Fallback se pred_calibration.json non esiste.
    """
    cal_path = _DATA / "pred_calibration.json"
    if not cal_path.exists():
        return {"up": 3.5, "down": -4.2}
    try:
        rows = json.loads(cal_path.read_text(encoding="utf-8"))
        up_vals = [r["d5_pred"] for r in rows
                   if isinstance(r.get("d5_pred"), (int, float))
                   and r.get("direction") in ("up", "rialzo", 1, "1")
                   and r["d5_pred"] is not None]
        dn_vals = [r["d5_pred"] for r in rows
                   if isinstance(r.get("d5_pred"), (int, float))
                   and r.get("direction") in ("down", "ribasso", -1, "-1", 0, "0")
                   and r["d5_pred"] is not None]
        up_med = sorted(up_vals)[len(up_vals) // 2] if up_vals else 3.5
        dn_med = sorted(dn_vals)[len(dn_vals) // 2] if dn_vals else -4.2
        return {"up": round(up_med, 2), "down": round(dn_med, 2)}
    except Exception as e:
        print(f"[LiveSignals] pred_calibration load warn: {e}")
        return {"up": 3.5, "down": -4.2}


def _pred5_for_ticker(
    ticker: str,
    direction: str,           # "up" / "down"
    pred_medians: dict,
    slope_5d: float | None,
    slope_20d: float | None,
) -> float:
    """
    Stima pred5 empirica:
    - Base: mediana storica per direzione
    - Scaling lineare per ampiezza slope (slope più forte → pred maggiore)
    """
    base = pred_medians.get(direction, 3.5 if direction == "up" else -4.2)
    eff_slope = slope_20d if slope_20d is not None else slope_5d
    if eff_slope is not None and abs(eff_slope) > 0.1:
        # Scala: ogni 0.5 pp/g aggiunge ~1% al pred5 (cap a ±15%)
        boost = min(abs(eff_slope) / 0.5, 3.0) * (1.0 if direction == "up" else -1.0)
        base = base + boost * (1.0 if direction == "up" else -1.0)
    return round(max(-15.0, min(15.0, base)), 2)


# ─── Download prezzi ──────────────────────────────────────────────────────────


def _fetch_quote_snapshot(tickers: list[str]) -> dict[str, dict]:
    """
    Chiama `yf.Ticker(t).fast_info` per ogni ticker e ritorna:
      { ticker: {
          "last_price":    unadjusted current price (Yahoo quote widget),
          "prev_close":    regular_market_previous_close (regular session
                           close del giorno prima, esclude after-hours;
                           equivalente al "Prev Close" di Bloomberg/Yahoo),
          "session_open":  unadjusted open della sessione corrente,
      } }

    Perché serve:
      * `closes[-2]` dallo storico auto-adjusted può soffrire di off-by-one
        (yfinance può o non può includere il partial bar di oggi) e usa
        prezzi split/dividend-adjusted → il livello assoluto non matcha
        Yahoo (bug ERNA reverse split);
      * `regular_market_previous_close` è il campo che Yahoo/Bloomberg
        usano ufficialmente per calcolare "% Change" — allineamento
        bit-per-bit con quello che vede l'utente sul quote widget.

    Threaded per performance: 60 ticker in ~2-3s con max_workers=10 vs
    ~17s in seriale.
    """
    try:
        import yfinance as yf
    except ImportError:
        return {}
    if not tickers:
        return {}

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _fetch_one(t: str) -> tuple[str, dict | None]:
        try:
            fi = yf.Ticker(t).fast_info
            last = _safe_float(getattr(fi, "last_price", None))
            prev = _safe_float(getattr(fi, "regular_market_previous_close", None))
            if prev is None:
                # Alcuni ticker (soprattutto ETF/warrant thin) espongono solo
                # `previous_close` (che include after-hours). Meglio di None.
                prev = _safe_float(getattr(fi, "previous_close", None))
            opn = _safe_float(getattr(fi, "open", None))
            if last is None and prev is None:
                return t, None
            return t, {
                "last_price":   last,
                "prev_close":   prev,
                "session_open": opn,
            }
        except Exception:
            return t, None

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = [ex.submit(_fetch_one, t) for t in tickers]
        for fut in as_completed(futures):
            t, doc = fut.result()
            if doc is not None:
                out[t] = doc
    return out


def _safe_float(v: object) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        if not (f == f):  # NaN check
            return None
        if f <= 0:
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None


def _fetch_live_prices(tickers: list[str]) -> dict[str, float]:
    """
    Batch download dei prezzi live tramite dati intraday 5-min di oggi.
    Usa l'ultimo tick disponibile — più accurato di closes[-1] (EOD precedente)
    durante le ore di mercato.
    """
    try:
        import yfinance as yf
        import pandas as pd
    except ImportError:
        return {}

    result: dict[str, float] = {}
    if not tickers:
        return result

    try:
        raw = yf.download(
            tickers, period="1d", interval="5m",
            auto_adjust=True, progress=False, threads=True,
        )
        if raw is None or (hasattr(raw, "empty") and raw.empty):
            return result

        for t in tickers:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if ("Close", t) in raw.columns:
                        s = raw[("Close", t)].dropna()
                    elif t in raw.columns.get_level_values(1):
                        s = raw["Close"][t].dropna()
                    else:
                        continue
                else:
                    s = raw["Close"].dropna()
                if not s.empty:
                    result[t] = round(float(s.iloc[-1]), 4)
            except Exception:
                continue
    except Exception as e:
        print(f"[LiveSignals] _fetch_live_prices fallita ({e})", flush=True)

    return result


def _fetch_session_opens(tickers: list[str], today: date) -> dict[str, float]:
    """Prezzo di apertura sessione Nasdaq (Yahoo fast_info / history)."""
    try:
        import yfinance as yf
    except ImportError:
        return {}

    result: dict[str, float] = {}
    for t in tickers:
        try:
            tk = yf.Ticker(t)
            fi = tk.fast_info
            op = fi.get("open") or fi.get("regularMarketOpen")
            if op is not None:
                v = float(op)
                if v > 0:
                    result[t] = round(v, 4)
                    continue
            info = tk.info or {}
            op = info.get("regularMarketOpen") or info.get("open")
            if op is not None:
                v = float(op)
                if v > 0:
                    result[t] = round(v, 4)
                    continue
            hist = tk.history(period="5d", auto_adjust=True)
            if hist is not None and not hist.empty:
                last_idx = hist.index[-1]
                if hasattr(last_idx, "date") and last_idx.date() == today:
                    v = float(hist["Open"].iloc[-1])
                    if v > 0:
                        result[t] = round(v, 4)
        except Exception:
            continue
    return result


"""
Ticker con ultima barra più vecchia di questa soglia (in giorni di calendario
rispetto al max_last_date visto nel batch) vengono considerati **delisted/halted**
e i loro campi live vengono nullificati a valle da `apply_metrics_to_snapshot`.
Warrant scaduti, delisting Form-25, halted-for-review producono tutti serie
storiche che si fermano di colpo; senza questo cut il vecchio Var. Giorn. %
resta scritto nello snapshot e la UI mostra "-25%" di un simbolo morto (bug
NRXPW luglio 2026).
"""
STALE_CUTOFF_DAYS = 5


def warrant_common_ticker(ticker: str) -> str | None:
    """
    Heuristic already used by HistLib: thin US warrants often append ``W``
    to the common symbol (JSPRW → JSPR, NRXPW → NRXP). Returns the common
    candidate, or None when the ticker does not look like a warrant suffix.
    """
    t = (ticker or "").strip().upper()
    if len(t) < 2 or not t.endswith("W") or t.endswith("WW"):
        return None
    common = t[:-1]
    return common if common and common != t else None


def _rescue_dead_warrants_via_common(
    dead_tickers: set[str],
    prices: dict[str, dict],
    live_prices: dict[str, float],
    session_opens: dict[str, float],
    quote_snapshot: dict[str, dict],
) -> tuple[dict[str, str], set[str]]:
    """
    For dead/stale warrants, retry the common stock and bind its feeds under
    the warrant key so UI/portfolio rows keep ``Ticker=JSPRW`` identity but
    receive tradeable JSPR quotes/metrics.

    Returns (alias_of, rescued) where alias_of maps warrant → common.
    """
    alias_of: dict[str, str] = {}
    candidates: list[tuple[str, str]] = []
    for t in sorted(dead_tickers):
        common = warrant_common_ticker(t)
        if common:
            candidates.append((t, common))
    if not candidates:
        return {}, set()

    need = sorted(
        {
            c
            for _, c in candidates
            if c not in prices and c not in quote_snapshot and c not in live_prices
        }
    )
    if need:
        ap, _ad = _fetch_prices(need)
        for c, doc in ap.items():
            prices.setdefault(c, doc)
        al = _fetch_live_prices(need)
        live_prices.update(al)
        ao = _fetch_session_opens(need, date.today())
        session_opens.update(ao)
        aq = _fetch_quote_snapshot(need)
        quote_snapshot.update(aq)
        print(
            f"[LiveSignals] Alias warrant→common: fetched {len(need)} commons "
            f"({sorted(need)})",
            flush=True,
        )

    rescued: set[str] = set()
    for warrant, common in candidates:
        has_feed = (
            common in prices
            or common in quote_snapshot
            or common in live_prices
        )
        if not has_feed:
            continue
        if common in prices:
            prices[warrant] = prices[common]
        if common in live_prices:
            live_prices[warrant] = live_prices[common]
        if common in session_opens:
            session_opens[warrant] = session_opens[common]
        if common in quote_snapshot:
            quote_snapshot[warrant] = quote_snapshot[common]
        alias_of[warrant] = common
        rescued.add(warrant)

    if rescued:
        print(
            f"[LiveSignals] Warrant alias attivo: "
            + ", ".join(f"{w}→{alias_of[w]}" for w in sorted(rescued)),
            flush=True,
        )
    return alias_of, rescued


def _fetch_prices(
    tickers: list[str],
    period: str = YF_PERIOD,
) -> tuple[dict[str, dict], set[str]]:
    """
    Scarica Close + Volume per una lista di ticker via yfinance.

    Ritorna una tupla:
      * prices     — { ticker: {"close": [...float], "volume": [...float]} }
                     solo per ticker con dati "freschi" (ultima barra entro
                     STALE_CUTOFF_DAYS dal max last_date del batch).
      * dead_set   — set di ticker richiesti ma senza dati usabili, sia perché
                     yfinance risponde "possibly delisted" sia perché l'ultima
                     barra è più vecchia di STALE_CUTOFF_DAYS (warrant scaduti,
                     halted, Form-25 delist, ecc.). Il chiamante deve usare
                     questo set per nullificare i campi live nello snapshot,
                     altrimenti i vecchi phantom price sopravvivono ad ogni
                     refresh (bug NRXPW luglio 2026).

    Batch-first, poi fallback singolo per due categorie:
      1) missing:  batch non ha restituito closes.
      2) stale:    batch ha restituito closes ma l'ultima barra è più vecchia
                   del max last_date visto tra gli altri ticker (freshness gap).
                   Questo cattura il bug noto di `yf.download` in batch che
                   per una parte dei ticker tronca la serie a 1 giorno indietro
                   senza restituire errore, lasciando il chiamante convinto che
                   il dato sia aggiornato.
    """
    try:
        import yfinance as yf
        import pandas as pd
    except ImportError:
        print("[LiveSignals] yfinance/pandas non disponibili — impossibile scaricare prezzi.")
        return {}, set()

    result: dict[str, dict] = {}
    last_dates: dict[str, date] = {}
    if not tickers:
        return result, set()

    # Batch download (più efficiente di N singole chiamate)
    print(f"[LiveSignals] Download prezzi {period} per {len(tickers)} ticker…", flush=True)
    try:
        raw = yf.download(
            tickers, period=period,
            auto_adjust=True, progress=False, threads=True,
        )
        if raw is None or (hasattr(raw, "empty") and raw.empty):
            raise ValueError("download vuoto")
    except Exception as e:
        print(f"[LiveSignals] Batch download fallito ({e}), provo singolo…", flush=True)
        raw = None

    def _extract_series_with_date(
        df, col: str, ticker: str,
    ) -> tuple[list[float], date | None]:
        try:
            if df is None:
                return [], None
            if isinstance(df.columns, pd.MultiIndex):
                if (col, ticker) in df.columns:
                    s = df[(col, ticker)].dropna()
                elif col in df.columns.get_level_values(0):
                    s = df[col][ticker].dropna()
                else:
                    return [], None
            else:
                if col in df.columns:
                    s = df[col].dropna()
                else:
                    return [], None
            if s.empty:
                return [], None
            last_idx = s.index[-1]
            last_d = last_idx.date() if hasattr(last_idx, "date") else None
            return [float(v) for v in s.values], last_d
        except Exception:
            return [], None

    if raw is not None:
        for t in tickers:
            closes, last_d = _extract_series_with_date(raw, "Close", t)
            volumes, _ = _extract_series_with_date(raw, "Volume", t)
            if closes:
                result[t] = {"close": closes, "volume": volumes}
                if last_d is not None:
                    last_dates[t] = last_d

    # Determina il most-recent trading day visto (freshness reference).
    max_last_date = max(last_dates.values()) if last_dates else None

    # Missing: ticker che il batch non ha restituito affatto.
    missing = [t for t in tickers if t not in result]
    # Stale:  ticker con closes ma ultima barra più vecchia di max_last_date.
    #         (bug noto di yf.download batch: tronca alcuni ticker di 1 giorno)
    stale: list[str] = []
    if max_last_date is not None:
        for t, d in last_dates.items():
            if d < max_last_date:
                stale.append(t)

    to_refetch = missing + stale
    # Ticker per cui il retry singolo ha restituito empty. Sono candidati
    # forti a "delisted/halted" anche se il batch ne aveva mantenuti dati
    # storici tronchi. Vengono marcati come dead a valle indipendentemente
    # dal cutoff di staleness.
    retry_empty: set[str] = set()
    if to_refetch:
        if stale:
            print(
                f"[LiveSignals] {len(stale)} ticker tronchi dal batch "
                f"(ultima barra < {max_last_date.isoformat()}): {stale}",
                flush=True,
            )
        for t in to_refetch:
            try:
                tk = yf.Ticker(t)
                hist = tk.history(period=period, auto_adjust=True)
                if not hist.empty:
                    result[t] = {
                        "close": [float(v) for v in hist["Close"].dropna()],
                        "volume": [float(v) for v in hist["Volume"].dropna()],
                    }
                    last_idx = hist.index[-1]
                    if hasattr(last_idx, "date"):
                        last_dates[t] = last_idx.date()
                else:
                    retry_empty.add(t)
            except Exception as e:
                print(f"[LiveSignals] {t}: errore download ({e})")
                retry_empty.add(t)

    if last_dates:
        fresh_max = max(last_dates.values())
        n_fresh = sum(1 for d in last_dates.values() if d == fresh_max)
        print(
            f"[LiveSignals] Prezzi disponibili: {len(result)}/{len(tickers)} · "
            f"al {fresh_max.isoformat()}: {n_fresh}/{len(result)}",
            flush=True,
        )
    else:
        print(f"[LiveSignals] Prezzi disponibili: {len(result)}/{len(tickers)} ticker", flush=True)

    # Costruisci dead_set:
    #   • richiesti ma mai popolati (yfinance vuoto → delisted / halted)
    #   • popolati ma ultima barra > STALE_CUTOFF_DAYS dal max_last_date
    #   • batch tronco + retry singolo empty (segnale forte di delist:
    #     yfinance dice "possibly delisted; no price data found" e i dati
    #     storici del batch non sono affidabili)
    #   • serie corta con volume 0 su tutte le ultime barre: caso tipico
    #     dei warrant scaduti (yfinance mantiene una barra fantasma
    #     dell'ultimo giorno di quote ma vol=0 = nessuno ha tradato).
    dead_set: set[str] = set()
    ref = max(last_dates.values()) if last_dates else None
    for t in tickers:
        if t not in result:
            dead_set.add(t)
            continue
        if t in retry_empty:
            # Batch aveva dati stali, ma yfinance singolo conferma delist.
            # Rimuovi anche i dati stali per non contaminare slope/RSI.
            dead_set.add(t)
            result.pop(t, None)
            continue
        # Zero-volume ghost bars: yfinance a volte ritorna 1-3 barre
        # sull'ultimo giorno di quote di un warrant scaduto (JSPRW =
        # 1 bar/vol=0 il 2026-07-13). Non serve aspettare i 5 gg di
        # staleness — la mancanza totale di volume è già diagnostica.
        closes = result[t].get("close") or []
        vols = result[t].get("volume") or []
        if closes and vols:
            check_n = min(5, len(vols))
            recent_vols = [v for v in vols[-check_n:] if v is not None]
            if recent_vols and all(v <= 0 for v in recent_vols):
                dead_set.add(t)
                result.pop(t, None)
                continue
        if ref is not None:
            d = last_dates.get(t)
            if d is None or (ref - d).days > STALE_CUTOFF_DAYS:
                dead_set.add(t)
                # Rimuovi anche dai fresh prices per non contaminare
                # slope/RSI/vol_ratio con dati vecchi > 5 giorni.
                result.pop(t, None)
    if dead_set:
        print(
            f"[LiveSignals] Ticker senza dati freschi (delisted/halted/stale > "
            f"{STALE_CUTOFF_DAYS}g): {sorted(dead_set)}",
            flush=True,
        )
    return result, dead_set


# ─── Parsing date ─────────────────────────────────────────────────────────────

def _parse_cd(v: Any) -> date | None:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(str(v), fmt).date()
        except (ValueError, TypeError):
            pass
    return None


# ─── Core ─────────────────────────────────────────────────────────────────────

def compute_live_signals(
    sim_snap: dict,
    prices: dict[str, dict],
    *,
    today: date | None = None,
    live_prices: dict[str, float] | None = None,
    session_opens: dict[str, float] | None = None,
    quote_snapshot: dict[str, dict] | None = None,
    price_mode: str = "live",
) -> dict[str, dict]:
    """
    Per ogni riga del simulation snapshot con CD ≤ horizon, calcola:
      slope_5d, slope_20d, slope_45d, run_up_30d, affid, pred5, direction
    Ritorna { ticker: {metrics} } indicizzato per ticker.

    ``price_mode``:
      - ``live`` — quote/fast_info + intraday 5m (RTH)
      - ``settled`` — ultimo close giornaliero completato (fuori RTH)
    """
    if today is None:
        today = date.today()
    settled = (price_mode or "live").strip().lower() == "settled"
    # Settled stamps = last NYSE 16:00 ET (≈22:00 Rome). Live = now UTC.
    if settled:
        price_asof_iso = last_regular_session_close().isoformat()
    else:
        price_asof_iso = datetime.now().astimezone().isoformat(timespec="seconds")

    pred_medians = _load_pred_medians()
    metrics: dict[str, dict] = {}

    col_ticker = next((c for c in sim_snap.get("columns", [])
                       if c.lower() == "ticker"), "Ticker")

    for row in sim_snap.get("rows", []):
        ticker = str(row.get(col_ticker) or row.get("Ticker") or "").strip().upper()
        if not ticker:
            continue

        cd_raw = None
        for k, v in row.items():
            if "completion" in k.lower() and "date" in k.lower():
                cd_raw = v
                break
        cd = _parse_cd(cd_raw)
        if cd is None:
            continue

        days_to_cd = (cd - today).days
        px = prices.get(ticker, {})
        closes = px.get("close", [])
        volumes = px.get("volume", [])

        slope5  = _slope_n(closes, 5)  if len(closes) >= MIN_BARS_SLOPE5  else None
        slope20 = _slope_n(closes, 20) if len(closes) >= MIN_BARS_SLOPE20 else None
        slope45 = _slope_n(closes, 45) if len(closes) >= MIN_BARS_SLOPE45 else None
        run30   = _run_up(closes, 30)  if len(closes) >= 30 else None
        rsi     = _rsi14(closes)
        vr      = _vol_ratio(volumes)

        slope_aligned = (
            (slope5 > 0) == (slope20 > 0)
            if slope5 is not None and slope20 is not None
            else None
        )
        r2 = _r2_linear(closes, 45) if len(closes) >= 15 else None

        aff = _affidabilita(days_to_cd, vr, slope20, rsi, slope5, slope_aligned, r2)

        eff_slope = slope20 if slope20 is not None else slope5
        direction = (
            "up" if eff_slope is not None and eff_slope > 0.1 else
            "down" if eff_slope is not None and eff_slope < -0.1 else
            "neutral"
        )
        # pred5 solo se c'è direzione chiara
        pred5 = (
            _pred5_for_ticker(ticker, direction, pred_medians, slope5, slope20)
            if direction != "neutral" else 0.0
        )

        # Yahoo/Bloomberg-canonical current price + prev close (unadjusted
        # values from `fast_info`). Preferiti in RTH perché matchano il
        # quote widget. Fuori RTH preferisci il close giornaliero completo
        # così una print di metà giornata non resta congelata overnight.
        quote = (quote_snapshot or {}).get(ticker) or {}
        live_px = (live_prices or {}).get(ticker)
        daily_last = round(closes[-1], 4) if closes else None
        daily_prev = (
            round(closes[-2], 4)
            if closes and len(closes) >= 2 and closes[-2] > 0
            else None
        )
        if settled:
            current_price = daily_last or quote.get("last_price") or live_px
            prev_close = daily_prev or quote.get("prev_close")
        else:
            current_price = (
                quote.get("last_price")
                or live_px
                or daily_last
            )
            # prev_close preferito: `regular_market_previous_close` (regular
            # session close di ieri, unadjusted). Fallback su closes[-2].
            prev_close = quote.get("prev_close") or daily_prev
        session_open = quote.get("session_open") or (session_opens or {}).get(ticker)

        # ── Low-liquidity noise flag ────────────────────────────────────
        # Warrant / pennystock sub-dime hanno bid-ask spread meccanico che
        # può causare ±20-30% di rumore per tick, senza corrispondenza con
        # eventi fondamentali. Esempio classico: ERNAW il 15/07/2026
        # segnalato −22.64% mentre il common ERNA (stesso issuer, stesso
        # catalyst positivo) chiudeva +11%.
        #
        # Trigger: (price < $1 OR ADV20 < 100k share) AND |Δgg%| > 15
        # Effetto downstream: il Decision Chart forza REVIEW (non SELL/BUY).
        try:
            daily_change_pct = (
                ((current_price - prev_close) / prev_close * 100)
                if (current_price is not None and prev_close and prev_close > 0)
                else None
            )
        except (TypeError, ZeroDivisionError):
            daily_change_pct = None

        # ADV = Average Daily Volume su ultimi 20 bar (share count, non $)
        adv_shares_20d = None
        if volumes and len(volumes) >= 5:
            recent_vols = [v for v in volumes[-20:] if v is not None and v > 0]
            if recent_vols:
                adv_shares_20d = int(sum(recent_vols) / len(recent_vols))

        low_liq_noise = False
        low_liq_reason = None
        if daily_change_pct is not None and abs(daily_change_pct) > 15.0:
            price_trigger = current_price is not None and current_price < 1.0
            adv_trigger = adv_shares_20d is not None and adv_shares_20d < 100_000
            if price_trigger or adv_trigger:
                low_liq_noise = True
                parts = []
                if price_trigger:
                    parts.append(f"price=${current_price:.4f}<$1")
                if adv_trigger:
                    parts.append(f"ADV20={adv_shares_20d:,d}<100k")
                low_liq_reason = "; ".join(parts) + f"; |Δ|={abs(daily_change_pct):.1f}%"

        metrics[ticker] = {
            "slope≈5g":   slope5,
            "slope≈20g":  slope20,
            "slope≈45g":  slope45,
            "run_up_30d": run30,
            "rsi_14":     rsi,
            "vol_ratio":  vr,
            "r2_live":    r2,
            "affid_live": aff,
            "affid_live_pct": round(aff / 100, 4),
            "pred5_live": pred5,
            "direction_live": direction,
            "days_to_cd": days_to_cd,
            "cd_date": cd.isoformat() if cd else None,
            "updated_at": price_asof_iso,
            "current_price": current_price,
            "prev_close": prev_close,
            "session_open": session_open,
            "adv_shares_20d": adv_shares_20d,
            "low_liq_noise": low_liq_noise,
            "low_liq_reason": low_liq_reason,
        }

    return metrics


def _col_key(columns: list[str], keyword: str) -> str | None:
    lo = keyword.lower()
    return next((c for c in columns if lo in c.lower()), None)


def apply_metrics_to_snapshot(
    snap: dict,
    metrics: dict[str, dict],
    *,
    dead_tickers: set[str] | None = None,
    quote_alias_of: dict[str, str] | None = None,
    dry_run: bool = False,
    update_prices: bool = True,
) -> dict:
    """
    Aggiunge slope/affid/pred5 come nuove colonne nelle righe del snapshot.
    Aggiorna anche le colonne Affidabilità% e Pred empirica +5gg se presenti.

    Se ``update_prices`` è False (fuori RTH NYSE), lascia invariati Prezzo
    Corrente / Var. Giorn. % / Prezzo Apertura e aggiorna solo i segnali tecnici.

    Se ``dead_tickers`` è fornito, ogni ticker in quel set (delisted / halted /
    stale > STALE_CUTOFF_DAYS) viene **nullificato** nelle colonne live prima
    di applicare `metrics`. Questo evita che un vecchio phantom price
    sopravviva ai refresh (bug NRXPW: warrant delistato mostra ancora
    "Var. Giorn. -25.71%" perché apply_metrics_to_snapshot non tocca le righe
    per cui il fetch corrente non ha dati).

    ``quote_alias_of`` maps sheet ticker → tradeable common (JSPRW→JSPR).
    For those rows we write common Var%/slopes but **do not** overwrite
    Prezzo Corrente with the common absolute price (warrant MTM stays on
    the last warrant mark / history).
    """
    cols = snap.get("columns", [])
    col_ticker = next((c for c in cols if c.lower() == "ticker"), "Ticker")
    alias_map = {k.upper(): v.upper() for k, v in (quote_alias_of or {}).items()}

    # Nuove colonne da aggiungere (se non esistono già)
    new_cols = ["slope≈5g", "slope≈20g", "slope≈45g", "run_up_30d",
                "rsi_14", "vol_ratio", "affid_live", "pred5_live",
                "direction_live", "live_updated_at",
                "adv_shares_20d", "low_liq_noise", "low_liq_reason",
                "live_quote_ticker", "quote_is_alias"]
    for nc in new_cols:
        if nc not in cols:
            cols.append(nc)

    affid_col  = _col_key(cols, "affidabilit")
    pred_col   = _col_key(cols, "pred empirica")
    prezzo_col = _col_key(cols, "Prezzo Corrente")
    var_col    = _col_key(cols, "var. giorn")
    open_col = "Prezzo Apertura ($)"
    if open_col not in cols:
        cols.append(open_col)

    dead_set = {t.upper() for t in (dead_tickers or set())}
    updated = 0
    nulled = 0
    for row in snap.get("rows", []):
        ticker = str(row.get(col_ticker) or "").strip().upper()
        m = metrics.get(ticker)
        # Se il ticker è "dead" (delisted / stale > cutoff), azzera i campi
        # live prima di skippare, così la UI mostra "—" invece del vecchio
        # phantom price. Non toccare le colonne fondamentali (Ticker, CD,
        # Studio Phase, ecc.) — solo i campi che il refresh live scriverebbe.
        if ticker and ticker in dead_set:
            live_field_map: list[tuple[str | None, object]] = [
                (prezzo_col, None),
                (var_col, None),
                (open_col, None),
                ("nasdaq_open_usd", None),
                ("slope≈5g", None),
                ("slope≈20g", None),
                ("slope≈45g", None),
                ("run_up_30d", None),
                ("rsi_14", None),
                ("vol_ratio", None),
                ("affid_live", None),
                ("pred5_live", None),
                ("direction_live", "stale"),
                ("live_updated_at", None),
                ("adv_shares_20d", None),
                ("low_liq_noise", False),
                ("low_liq_reason", None),
                ("live_quote_ticker", None),
                ("quote_is_alias", False),
            ]
            touched = False
            for col_name, new_val in live_field_map:
                if not col_name:
                    continue
                # Always write (even if the key was missing) so flags like
                # direction_live="stale" survive for the UI filter. Previously
                # we only updated keys already present → NRXPW kept direction_live
                # unset and stayed visible as a normal opportunity.
                if row.get(col_name) != new_val:
                    row[col_name] = new_val
                    touched = True
            if touched:
                nulled += 1
            continue
        if not m:
            continue

        row["slope≈5g"]       = m["slope≈5g"]
        row["slope≈20g"]      = m["slope≈20g"]
        row["slope≈45g"]      = m["slope≈45g"]
        row["run_up_30d"]     = m["run_up_30d"]
        row["rsi_14"]         = m["rsi_14"]
        row["vol_ratio"]      = m["vol_ratio"]
        row["affid_live"]     = m["affid_live"]
        row["pred5_live"]     = m["pred5_live"]
        row["direction_live"] = m["direction_live"]
        row["live_updated_at"] = m["updated_at"]
        row["adv_shares_20d"] = m.get("adv_shares_20d")
        row["low_liq_noise"]  = bool(m.get("low_liq_noise"))
        row["low_liq_reason"] = m.get("low_liq_reason")

        alias_common = alias_map.get(ticker)
        if alias_common:
            row["live_quote_ticker"] = alias_common
            row["quote_is_alias"] = True
        else:
            row["live_quote_ticker"] = None
            row["quote_is_alias"] = False

        # Sovrascrive Affidabilità% con valore live (in frazione 0-1)
        if affid_col:
            row[affid_col] = m["affid_live_pct"]

        # Sovrascrive Pred empirica +5gg con pred5 live (in frazione)
        if pred_col:
            row[pred_col] = round(m["pred5_live"] / 100, 6)

        # Prezzo / Var. Giorn. / open — RTH = live; fuori RTH = chiusura
        # ufficiale (settled). Non lasciare quote di metà giornata overnight.
        if update_prices:
            # Alias warrant→common: write Var% / open from the common feed,
            # but never replace warrant Prezzo Corrente with common $ (MTM).
            if not alias_common and prezzo_col and m.get("current_price"):
                row[prezzo_col] = m["current_price"]

            # Ricalcola Var. Giorn. % coerente con il prezzo appena scritto:
            # (current_price - prev_close) / prev_close · 100.
            cur = m.get("current_price")
            prev_c = m.get("prev_close")
            if (
                var_col
                and cur is not None
                and prev_c is not None
                and prev_c > 0
            ):
                row[var_col] = round((cur - prev_c) / prev_c * 100, 2)

            if m.get("session_open"):
                row[open_col] = m["session_open"]
                row["nasdaq_open_usd"] = m["session_open"]

        updated += 1

    snap["columns"] = cols
    # Prefer a real as-of from metrics (session close ISO); fallback date.
    asof_candidates = [
        str(m.get("updated_at") or "")
        for m in metrics.values()
        if isinstance(m, dict) and m.get("updated_at")
    ]
    snap["live_signals_updated_at"] = (
        max(asof_candidates) if asof_candidates else date.today().isoformat()
    )
    msg_tail = f" · nullificate {nulled} righe dead" if nulled else ""
    print(
        f"[LiveSignals] Aggiornate {updated} righe con metriche live.{msg_tail}",
        flush=True,
    )
    return snap


def _open_portfolio_tickers(snap: dict[str, Any], col_ticker: str) -> set[str]:
    """Tickers with open capital in invest_sim_inputs or sheet Capitale > 0."""
    out: set[str] = set()
    inputs_path = _DATA / "invest_sim_inputs.json"
    if inputs_path.is_file():
        try:
            doc = json.loads(inputs_path.read_text(encoding="utf-8"))
            raw = doc.get("inputs") if isinstance(doc, dict) else None
            if isinstance(raw, dict):
                for key, entry in raw.items():
                    if not isinstance(entry, dict):
                        continue
                    cap = entry.get("capital")
                    buy = entry.get("buyPrice")
                    try:
                        cap_f = float(cap) if cap is not None else 0.0
                        buy_f = float(buy) if buy is not None else 0.0
                    except (TypeError, ValueError):
                        continue
                    if cap_f > 0 and buy_f > 0:
                        tk = str(key).split("|", 1)[0].strip().upper()
                        if tk:
                            out.add(tk)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[LiveSignals] invest_sim_inputs warn: {exc}", flush=True)

    cap_cols = [
        c
        for c in (snap.get("columns") or [])
        if isinstance(c, str)
        and ("capitale" in c.lower() or c.lower() in ("capital", "capital ($)"))
    ]
    for row in snap.get("rows") or []:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get(col_ticker) or "").strip().upper()
        if not ticker or ticker.startswith("TOTALE"):
            continue
        for ck in cap_cols:
            try:
                if float(row.get(ck) or 0) > 0:
                    out.add(ticker)
                    break
            except (TypeError, ValueError):
                continue
    return out


def run(
    *,
    cd_horizon: int = DEFAULT_CD_HORIZON_DAYS,
    dry_run: bool = False,
    force_prices: bool = False,
) -> bool:
    today = date.today()
    env_force = os.environ.get("LIVE_SIGNALS_FORCE_PRICES", "").strip().lower() in (
        "1", "true", "yes", "on",
    )
    write_prices, session_reason = should_write_live_prices(
        force=bool(force_prices or env_force),
    )
    price_mode = live_price_write_mode(session_reason)
    print(
        f"[LiveSignals] Price write: {write_prices} · mode={price_mode} · "
        f"session={session_reason}",
        flush=True,
    )
    _write_status("running", None, "Download prezzi in corso…")

    # 1. Carica snapshot
    if not _SIM_SNAP.exists():
        msg = f"Snapshot non trovato: {_SIM_SNAP}"
        print(f"[LiveSignals] ERRORE: {msg}")
        _write_status("error", False, msg)
        return False

    snap = json.loads(_SIM_SNAP.read_text(encoding="utf-8"))
    cols = snap.get("columns", [])
    col_ticker = next((c for c in cols if c.lower() == "ticker"), "Ticker")

    # 2. Filtra ticker con CD ≤ horizon
    targets: dict[str, int] = {}   # ticker → days_to_cd
    for row in snap.get("rows", []):
        ticker = str(row.get(col_ticker) or "").strip().upper()
        if not ticker or ticker.startswith("TOTALE"):
            continue
        cd_raw = next(
            (v for k, v in row.items()
             if "completion" in k.lower() and "date" in k.lower()),
            None,
        )
        cd = _parse_cd(cd_raw)
        if cd is None:
            continue
        days = (cd - today).days
        if -7 <= days <= cd_horizon:
            targets[ticker] = days

    # 2b. Always refresh open-book tickers (capital > 0), even if CD > horizon.
    # Otherwise Pulse/desktop can stay stuck at buy price (e.g. ZNTL T−114d)
    # while mobile/VPS show the live mark → false "loss only on mobile".
    portfolio_tickers = _open_portfolio_tickers(snap, col_ticker)
    added_portfolio: list[str] = []
    for ticker in sorted(portfolio_tickers):
        if ticker in targets:
            continue
        days = 999
        for row in snap.get("rows", []):
            if str(row.get(col_ticker) or "").strip().upper() != ticker:
                continue
            cd_raw = next(
                (v for k, v in row.items()
                 if "completion" in k.lower() and "date" in k.lower()),
                None,
            )
            cd = _parse_cd(cd_raw)
            if cd is not None:
                days = (cd - today).days
            break
        targets[ticker] = days
        added_portfolio.append(ticker)
    if added_portfolio:
        print(
            f"[LiveSignals] +{len(added_portfolio)} open-book fuori horizon CD: "
            f"{added_portfolio}",
            flush=True,
        )

    # 2c. Hype funnel rows (often CD ≫ 90d) — still need price/slopes for KPI.
    added_hype: list[str] = []
    for row in snap.get("rows", []):
        if not row.get("hype_volume_funnel"):
            continue
        ticker = str(row.get(col_ticker) or "").strip().upper()
        if not ticker or ticker in targets:
            continue
        cd_raw = next(
            (v for k, v in row.items()
             if "completion" in k.lower() and "date" in k.lower()),
            None,
        )
        cd = _parse_cd(cd_raw)
        days = (cd - today).days if cd is not None else 999
        targets[ticker] = days
        added_hype.append(ticker)
    if added_hype:
        print(
            f"[LiveSignals] +{len(added_hype)} hype-funnel fuori horizon CD: "
            f"{added_hype}",
            flush=True,
        )

    if not targets:
        msg = f"Nessun ticker con CD nei prossimi {cd_horizon} giorni."
        print(f"[LiveSignals] {msg}")
        _write_status("ok", True, msg)
        return True

    print(f"[LiveSignals] {len(targets)} ticker da aggiornare:", list(targets.keys()))

    # 3. Download prezzi storici (slope/RSI) + prezzi live (current price)
    ticker_list = list(targets.keys())
    prices, dead_tickers = _fetch_prices(ticker_list)
    live_prices = _fetch_live_prices(ticker_list)
    session_opens = _fetch_session_opens(ticker_list, today)
    # Yahoo/Bloomberg-canonical quote snapshot (unadjusted last price +
    # regular_market_previous_close). Usato in via prioritaria da
    # compute_live_signals per calcolare Var. Giorn. % con la stessa
    # convenzione dei big provider (matcha 1:1 con Yahoo quote widget).
    quote_snapshot = _fetch_quote_snapshot(ticker_list)
    # Rimuovi i dead ticker anche dai live_prices/session_opens/quote per
    # evitare che il live intraday feed reincoli un valore su un simbolo
    # delistato.
    for t in dead_tickers:
        live_prices.pop(t, None)
        session_opens.pop(t, None)
        quote_snapshot.pop(t, None)
    # Dead thin warrants (JSPRW…): bind tradeable common feed under warrant key.
    quote_alias_of, rescued = _rescue_dead_warrants_via_common(
        dead_tickers, prices, live_prices, session_opens, quote_snapshot,
    )
    dead_tickers = set(dead_tickers) - rescued
    print(f"[LiveSignals] Quote fast_info: {len(quote_snapshot)}/{len(ticker_list)} ticker", flush=True)
    print(f"[LiveSignals] Prezzi live: {len(live_prices)}/{len(ticker_list)} ticker", flush=True)
    print(f"[LiveSignals] Aperture sessione: {len(session_opens)}/{len(ticker_list)} ticker", flush=True)

    # 4. Calcola metriche
    metrics = compute_live_signals(
        snap, prices, today=today,
        live_prices=live_prices, session_opens=session_opens,
        quote_snapshot=quote_snapshot,
        price_mode=price_mode,
    )
    print(f"[LiveSignals] Metriche calcolate per {len(metrics)} ticker.", flush=True)

    # 5. Applica al snapshot (metrics fresche + nullifica dead ticker)
    snap = apply_metrics_to_snapshot(
        snap,
        metrics,
        dead_tickers=dead_tickers,
        quote_alias_of=quote_alias_of,
        dry_run=dry_run,
        update_prices=write_prices,
    )

    # 5a. P(continuation) — growth exhaustion vs own history + HistLib population
    try:
        from prediction.continuation_score import (
            apply_continuation_to_snapshot,
            score_tickers,
        )

        col_tk = next(
            (c for c in (snap.get("columns") or []) if str(c).lower() == "ticker"),
            "Ticker",
        )
        cont_tickers = sorted(
            {
                str(r.get(col_tk) or "").strip().upper()
                for r in (snap.get("rows") or [])
                if isinstance(r, dict) and str(r.get(col_tk) or "").strip()
            }
        )
        cont_scores = score_tickers(cont_tickers)
        apply_continuation_to_snapshot(snap, cont_scores)
        n_cont = sum(1 for s in cont_scores.values() if s.p_continuation is not None)
        print(
            f"[LiveSignals] P(continuation): {n_cont}/{len(cont_tickers)} scored "
            f"(pop={max((s.features.n_pop for s in cont_scores.values()), default=0)})",
            flush=True,
        )
    except Exception as _cont_exc:
        print(f"[LiveSignals] P(continuation) warn: {_cont_exc}", flush=True)

    # 5b. Audit log per tab Pre-CD signals (Model analysis)
    if not dry_run and metrics:
        try:
            from prediction.signal_audit import (
                append_refresh_batch,
                build_calibration_document,
                entries_from_live_metrics,
            )

            cd_map = {
                tk: str(m.get("cd_date") or "")
                for tk, m in metrics.items()
                if m.get("cd_date")
            }
            batch = entries_from_live_metrics(metrics, cd_by_ticker=cd_map)
            n_log = append_refresh_batch(batch)
            if n_log:
                build_calibration_document(close_outcomes_first=True)
                print(f"[LiveSignals] signal_audit: +{n_log} righe", flush=True)
        except Exception as _aud:
            print(f"[LiveSignals] signal_audit warn: {_aud}", flush=True)

    # 6. Scrivi snapshot aggiornato + bump manifest (UI reload / label as-of)
    if not dry_run:
        _SIM_SNAP.write_text(
            json.dumps(snap, ensure_ascii=False, indent=None),
            encoding="utf-8",
        )
        prices_as_of = str(snap.get("live_signals_updated_at") or "")
        try:
            from supernova_web_scheduler import bump_desktop_manifest

            bump_desktop_manifest()
            # Stamp prices_as_of = NYSE close (settled) so UI shows 22:00 Roma
            # instead of the mid-day freeze time from an older workbook refresh.
            from orchestrator_io_paths import DESKTOP_DATA_MANIFEST_JSON

            man_path = Path(DESKTOP_DATA_MANIFEST_JSON)
            if man_path.is_file() and prices_as_of:
                try:
                    man = json.loads(man_path.read_text(encoding="utf-8"))
                    if isinstance(man, dict):
                        man["prices_as_of"] = prices_as_of
                        man["live_signals_updated_at"] = prices_as_of
                        man_path.write_text(
                            json.dumps(man, indent=2, ensure_ascii=False),
                            encoding="utf-8",
                        )
                except (OSError, json.JSONDecodeError) as exc:
                    print(f"[LiveSignals] manifest prices_as_of warn: {exc}", flush=True)
        except Exception as exc:
            print(f"[LiveSignals] manifest bump warn: {exc}", flush=True)
        price_note = (
            f"prezzi aggiornati · as_of={prices_as_of}"
            if write_prices
            else f"prezzi congelati ({session_reason})"
        )
        msg = (
            f"Live signals aggiornati: {len(metrics)} ticker · "
            f"{date.today().isoformat()} · {price_note}"
        )
        print(f"[LiveSignals] OK — {msg}", flush=True)
        _write_status("ok", True, msg)
        try:
            from hype_volume_funnel import patch_hype_financials_from_enrich_cache

            n_fin = patch_hype_financials_from_enrich_cache()
            if n_fin:
                print(
                    f"[LiveSignals] hype Beta/Liquidità da enrich_cache: {n_fin} row(s)",
                    flush=True,
                )
        except Exception as _hf:
            print(f"[LiveSignals] hype financials warn: {_hf}", flush=True)
    else:
        print("[LiveSignals] --dry-run: nessuna scrittura.", flush=True)
        _write_status("dry_run", True, "Dry-run completato.")

    return True


# ─── Status file ──────────────────────────────────────────────────────────────

def _write_status(state: str, ok: bool | None, message: str) -> None:
    try:
        _STATUS_FILE.write_text(
            json.dumps({
                "state": state, "ok": ok,
                "message": message,
                "ts": datetime.utcnow().isoformat() + "Z",
            }),
            encoding="utf-8",
        )
    except Exception:
        pass


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Calcola ma non scrive.")
    ap.add_argument("--cd-horizon", type=int, default=DEFAULT_CD_HORIZON_DAYS,
                    help=f"Considera CD fino a N giorni da oggi (default {DEFAULT_CD_HORIZON_DAYS})")
    ap.add_argument(
        "--force-prices",
        action="store_true",
        help="Forza modalità live (quote intraday) anche fuori RTH NYSE.",
    )
    args = ap.parse_args(argv)

    ok = run(
        cd_horizon=args.cd_horizon,
        dry_run=args.dry_run,
        force_prices=args.force_prices,
    )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
