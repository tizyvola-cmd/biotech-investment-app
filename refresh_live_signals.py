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


def _fetch_prices(tickers: list[str], period: str = YF_PERIOD) -> dict[str, dict]:
    """
    Scarica Close + Volume per una lista di ticker via yfinance.
    Ritorna { ticker: {"close": [...float], "volume": [...float]} }
    """
    try:
        import yfinance as yf
        import pandas as pd
    except ImportError:
        print("[LiveSignals] yfinance/pandas non disponibili — impossibile scaricare prezzi.")
        return {}

    result: dict[str, dict] = {}
    if not tickers:
        return result

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

    def _extract_series(df, col: str, ticker: str) -> list[float]:
        try:
            if df is None:
                return []
            if isinstance(df.columns, pd.MultiIndex):
                if (col, ticker) in df.columns:
                    s = df[(col, ticker)].dropna()
                elif col in df.columns.get_level_values(0):
                    s = df[col][ticker].dropna()
                else:
                    return []
            else:
                if col in df.columns:
                    s = df[col].dropna()
                else:
                    return []
            return [float(v) for v in s.values]
        except Exception:
            return []

    if raw is not None:
        for t in tickers:
            closes = _extract_series(raw, "Close", t)
            volumes = _extract_series(raw, "Volume", t)
            if closes:
                result[t] = {"close": closes, "volume": volumes}

    # Fallback singolo per ticker mancanti
    missing = [t for t in tickers if t not in result]
    for t in missing:
        try:
            tk = yf.Ticker(t)
            hist = tk.history(period=period, auto_adjust=True)
            if not hist.empty:
                result[t] = {
                    "close": [float(v) for v in hist["Close"].dropna()],
                    "volume": [float(v) for v in hist["Volume"].dropna()],
                }
        except Exception as e:
            print(f"[LiveSignals] {t}: errore download ({e})")

    print(f"[LiveSignals] Prezzi disponibili: {len(result)}/{len(tickers)} ticker", flush=True)
    return result


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
) -> dict[str, dict]:
    """
    Per ogni riga del simulation snapshot con CD ≤ horizon, calcola:
      slope_5d, slope_20d, slope_45d, run_up_30d, affid, pred5, direction
    Ritorna { ticker: {metrics} } indicizzato per ticker.
    """
    if today is None:
        today = date.today()

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

        # Prefer live intraday price; fall back to last EOD close
        live_px = (live_prices or {}).get(ticker)
        current_price = live_px if live_px else (round(closes[-1], 4) if closes else None)
        session_open = (session_opens or {}).get(ticker)

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
            "updated_at": today.isoformat(),
            "current_price": current_price,
            "session_open": session_open,
        }

    return metrics


def _col_key(columns: list[str], keyword: str) -> str | None:
    lo = keyword.lower()
    return next((c for c in columns if lo in c.lower()), None)


def apply_metrics_to_snapshot(
    snap: dict,
    metrics: dict[str, dict],
    *,
    dry_run: bool = False,
) -> dict:
    """
    Aggiunge slope/affid/pred5 come nuove colonne nelle righe del snapshot.
    Aggiorna anche le colonne Affidabilità% e Pred empirica +5gg se presenti.
    """
    cols = snap.get("columns", [])
    col_ticker = next((c for c in cols if c.lower() == "ticker"), "Ticker")

    # Nuove colonne da aggiungere (se non esistono già)
    new_cols = ["slope≈5g", "slope≈20g", "slope≈45g", "run_up_30d",
                "rsi_14", "vol_ratio", "affid_live", "pred5_live",
                "direction_live", "live_updated_at"]
    for nc in new_cols:
        if nc not in cols:
            cols.append(nc)

    affid_col  = _col_key(cols, "affidabilit")
    pred_col   = _col_key(cols, "pred empirica")
    prezzo_col = _col_key(cols, "Prezzo Corrente")
    open_col = "Prezzo Apertura ($)"
    if open_col not in cols:
        cols.append(open_col)

    updated = 0
    for row in snap.get("rows", []):
        ticker = str(row.get(col_ticker) or "").strip().upper()
        m = metrics.get(ticker)
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

        # Sovrascrive Affidabilità% con valore live (in frazione 0-1)
        if affid_col:
            row[affid_col] = m["affid_live_pct"]

        # Sovrascrive Pred empirica +5gg con pred5 live (in frazione)
        if pred_col:
            row[pred_col] = round(m["pred5_live"] / 100, 6)

        # Aggiorna Prezzo Corrente con l'ultimo close scaricato da Yahoo
        if prezzo_col and m.get("current_price"):
            row[prezzo_col] = m["current_price"]

        if m.get("session_open"):
            row[open_col] = m["session_open"]
            row["nasdaq_open_usd"] = m["session_open"]

        updated += 1

    snap["columns"] = cols
    snap["live_signals_updated_at"] = date.today().isoformat()
    print(f"[LiveSignals] Aggiornate {updated} righe con metriche live.", flush=True)
    return snap


def run(
    *,
    cd_horizon: int = DEFAULT_CD_HORIZON_DAYS,
    dry_run: bool = False,
) -> bool:
    today = date.today()
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

    if not targets:
        msg = f"Nessun ticker con CD nei prossimi {cd_horizon} giorni."
        print(f"[LiveSignals] {msg}")
        _write_status("ok", True, msg)
        return True

    print(f"[LiveSignals] {len(targets)} ticker da aggiornare:", list(targets.keys()))

    # 3. Download prezzi storici (slope/RSI) + prezzi live (current price)
    ticker_list = list(targets.keys())
    prices = _fetch_prices(ticker_list)
    live_prices = _fetch_live_prices(ticker_list)
    session_opens = _fetch_session_opens(ticker_list, today)
    print(f"[LiveSignals] Prezzi live: {len(live_prices)}/{len(ticker_list)} ticker", flush=True)
    print(f"[LiveSignals] Aperture sessione: {len(session_opens)}/{len(ticker_list)} ticker", flush=True)

    # 4. Calcola metriche
    metrics = compute_live_signals(
        snap, prices, today=today, live_prices=live_prices, session_opens=session_opens,
    )
    print(f"[LiveSignals] Metriche calcolate per {len(metrics)} ticker.", flush=True)

    # 5. Applica al snapshot
    snap = apply_metrics_to_snapshot(snap, metrics, dry_run=dry_run)

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

    # 6. Scrivi snapshot aggiornato
    if not dry_run:
        _SIM_SNAP.write_text(
            json.dumps(snap, ensure_ascii=False, indent=None),
            encoding="utf-8",
        )
        msg = (
            f"Live signals aggiornati: {len(metrics)} ticker · "
            f"{date.today().isoformat()}"
        )
        print(f"[LiveSignals] OK — {msg}", flush=True)
        _write_status("ok", True, msg)
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
    args = ap.parse_args(argv)

    ok = run(cd_horizon=args.cd_horizon, dry_run=args.dry_run)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
