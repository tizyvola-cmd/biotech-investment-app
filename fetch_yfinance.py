"""
Quote e metadati Yahoo per l'universo biotech.

Modalità incrementale (default):
  - Per simbolo: cache su disco ``data/yf_cache/{SYMBOL}.json``
  - Metadati (nome, settore, …) riusati se già in cache (``YF_CACHE_STICKY=1`` default)
  - Solo simboli **nuovi** o cache assente vengono scaricati per intero
  - ``yf.json`` viene **fuso** con il file precedente (non tutto riscaricato ogni run)

Env utili:
  YF_CACHE_STICKY=1          — cache per-simbolo senza scadenza (default on)
  YF_QUOTE_REFRESH_HOURS=1   — se cache esiste, aggiorna solo prezzo/beta (leggero)
  YF_CACHE_TTL_HOURS=168     — se sticky off: TTL metadati (default 7 giorni)
  YF_FORCE_FULL_REFRESH=1    — ignora cache e riscarica tutti i simboli
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from tqdm import tqdm

if os.environ.get("YFINANCE_VERBOSE", "").strip() not in ("1", "true", "TRUE", "yes"):
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

DATA_DIR = "data"
OUTPUT_JSON_PATH = os.path.join(DATA_DIR, "yf.json")
OUTPUT_XLSX_PATH = os.path.join(DATA_DIR, "yf.xlsx")
CACHE_DIR = os.path.join(DATA_DIR, "yf_cache")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

COLUMN_DESCRIPTIONS = {
    "symbol":          "Ticker del titolo in borsa",
    "companyName":     "Nome completo dell'azienda",
    "sector":          "Settore di appartenenza (es. Healthcare)",
    "industry":        "Sotto-settore specifico (es. Biotechnology)",
    "marketCap":       "Capitalizzazione di mercato: prezzo × azioni in circolazione",
    "enterpriseValue": "EV = Market Cap + debito - cassa. Il valore reale dell'azienda indipendentemente dalla struttura finanziaria",
    "beta":            "Volatilità relativa al mercato. >1 = più volatile, <1 = meno volatile, tipicamente alto per biotech",
    "previousClose":   "Prezzo di chiusura dell'ultima sessione di borsa",
    "currentPrice":    "Prezzo corrente del titolo (aggiornato in tempo reale durante le ore di mercato)",
    "dailyChange_%":   "Variazione % del prezzo tra la chiusura di ieri e il prezzo attuale di oggi",
    "currency":        "Valuta in cui è quotato il titolo",
    "country":         "Paese di sede legale dell'azienda",
    "website":         "Sito web ufficiale dell'azienda",
}

HEADER_FILL = PatternFill("solid", fgColor="4472C4")
HEADER_FONT = Font(bold=True, color="FFFFFF")
DESC_FILL   = PatternFill("solid", fgColor="D9E1F2")
DESC_FONT   = Font(italic=True, color="444444", size=8)


def _yf_cache_sticky() -> bool:
    v = os.environ.get("YF_CACHE_STICKY", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _yf_force_full_refresh() -> bool:
    return os.environ.get("YF_FORCE_FULL_REFRESH", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _yf_cache_ttl_hours() -> float:
    if _yf_cache_sticky():
        return 8760.0 * 50
    try:
        return float(os.environ.get("YF_CACHE_TTL_HOURS", "168").strip() or "168")
    except ValueError:
        return 168.0


def _yf_quote_refresh_hours() -> float:
    try:
        return float(os.environ.get("YF_QUOTE_REFRESH_HOURS", "1").strip() or "1")
    except ValueError:
        return 1.0


def cache_path(symbol: str) -> str:
    return os.path.join(CACHE_DIR, f"{symbol}.json")


def _cache_mtime(path: str) -> datetime | None:
    if not os.path.isfile(path):
        return None
    try:
        return datetime.fromtimestamp(os.path.getmtime(path))
    except OSError:
        return None


def load_cache(symbol: str) -> dict | None:
    path = cache_path(symbol)
    if not os.path.isfile(path):
        return None
    mtime = _cache_mtime(path)
    if mtime is None:
        return None
    age_h = (datetime.now() - mtime).total_seconds() / 3600.0
    if age_h > _yf_cache_ttl_hours() and not _yf_cache_sticky():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_cache(symbol: str, data: dict) -> None:
    with open(cache_path(symbol), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _needs_quote_refresh(symbol: str) -> bool:
    if _yf_force_full_refresh():
        return True
    mtime = _cache_mtime(cache_path(symbol))
    if mtime is None:
        return True
    age_h = (datetime.now() - mtime).total_seconds() / 3600.0
    return age_h >= _yf_quote_refresh_hours()


def _fetch_quotes_only(symbol: str, base: dict) -> dict:
    """Aggiorna solo campi prezzo/beta; mantiene metadati storici in ``base``."""
    out = dict(base)
    out["symbol"] = symbol
    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        info = t.info or {}
        prev = fi.get("previous_close") or info.get("previousClose")
        curr = (
            fi.get("last_price")
            or info.get("currentPrice")
            or info.get("regularMarketPrice")
        )
        open_px = (
            fi.get("open")
            or info.get("regularMarketOpen")
            or info.get("open")
        )
        out["previousClose"] = prev
        out["currentPrice"] = curr
        out["regularMarketOpen"] = open_px
        if prev and curr:
            try:
                out["dailyChange_%"] = round(
                    ((float(curr) - float(prev)) / float(prev)) * 100.0, 2
                )
            except (TypeError, ValueError, ZeroDivisionError):
                out["dailyChange_%"] = None
        _b = info.get("beta")
        if _b is not None:
            out["beta"] = _b
        _mc = fi.get("market_cap") or info.get("marketCap")
        if _mc is not None:
            out["marketCap"] = _mc
    except Exception:
        pass
    return out


def fetch_symbol(symbol: str) -> dict:
    cached = None if _yf_force_full_refresh() else load_cache(symbol)
    if cached is not None and not _needs_quote_refresh(symbol):
        return cached

    if cached is not None and _needs_quote_refresh(symbol):
        updated = _fetch_quotes_only(symbol, cached)
        save_cache(symbol, updated)
        return updated

    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        info = t.info or {}

        prev = fi.get("previous_close") or info.get("previousClose")
        curr = (
            fi.get("last_price")
            or info.get("currentPrice")
            or info.get("regularMarketPrice")
        )
        open_px = (
            fi.get("open")
            or info.get("regularMarketOpen")
            or info.get("open")
        )

        data = {
            "symbol":          symbol,
            "companyName":     info.get("longName"),
            "sector":          info.get("sector"),
            "industry":        info.get("industry"),
            "marketCap":       fi.get("market_cap") or info.get("marketCap"),
            "enterpriseValue": info.get("enterpriseValue"),
            "beta":            info.get("beta"),
            "previousClose":   prev,
            "currentPrice":    curr,
            "regularMarketOpen": open_px,
            "dailyChange_%":   round(((curr - prev) / prev) * 100, 2) if prev and curr else None,
            "website":         info.get("website"),
            "currency":        fi.get("currency"),
            "country":         info.get("country"),
        }

        save_cache(symbol, data)
        return data

    except Exception:
        if cached:
            return cached

        return {
            "symbol":          symbol,
            "companyName":     None,
            "sector":          None,
            "industry":        None,
            "marketCap":       None,
            "enterpriseValue": None,
            "beta":            None,
            "previousClose":   None,
            "currentPrice":    None,
            "dailyChange_%":   None,
            "website":         None,
            "currency":        None,
            "country":         None,
        }


def load_existing_yf_json() -> dict[str, dict]:
    if not os.path.isfile(OUTPUT_JSON_PATH):
        return {}
    try:
        with open(OUTPUT_JSON_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except Exception:
        return {}
    out: dict[str, dict] = {}
    if isinstance(rows, list):
        for r in rows:
            if isinstance(r, dict) and r.get("symbol"):
                out[str(r["symbol"]).strip().upper()] = r
    return out


def save_outputs(records: list[dict]) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)

    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    df = pd.DataFrame(records)

    preferred_cols = [
        "symbol",
        "companyName",
        "sector",
        "industry",
        "marketCap",
        "enterpriseValue",
        "beta",
        "previousClose",
        "currentPrice",
        "dailyChange_%",
        "currency",
        "country",
        "website",
    ]

    cols = [c for c in preferred_cols if c in df.columns] + [
        c for c in df.columns if c not in preferred_cols
    ]
    df = df[cols]

    with pd.ExcelWriter(OUTPUT_XLSX_PATH, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="YFinance")
        ws = writer.sheets["YFinance"]

        for col_idx in range(1, len(cols) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            ws.column_dimensions[get_column_letter(col_idx)].width = 28

        ws.insert_rows(2)
        for col_idx, col_name in enumerate(cols, start=1):
            cell = ws.cell(row=2, column=col_idx)
            cell.value = COLUMN_DESCRIPTIONS.get(col_name, "")
            cell.fill = DESC_FILL
            cell.font = DESC_FONT

        ws.freeze_panes = "A3"
        ws.row_dimensions[2].height = 28

    print(f"Saved JSON:  {OUTPUT_JSON_PATH}")
    print(f"Saved Excel: {OUTPUT_XLSX_PATH}")


def run_fetch(symbols: list[str]) -> list[dict]:
    prior = load_existing_yf_json()
    n_skip = 0
    n_quote = 0
    n_full = 0
    results: list[dict] = []

    for symbol in tqdm(symbols, desc="YFINANCE (incremental)"):
        sym = str(symbol).strip().upper()
        if not sym:
            continue
        had_cache = (not _yf_force_full_refresh()) and (
            sym in prior or load_cache(sym) is not None
        )
        need_quote = _needs_quote_refresh(sym) if had_cache else True
        row = fetch_symbol(sym)
        results.append(row)
        if _yf_force_full_refresh():
            n_full += 1
        elif not had_cache:
            n_full += 1
        elif need_quote:
            n_quote += 1
        else:
            n_skip += 1

    print(
        f"[YFinance] Incrementale: {n_skip} da cache (nessuna chiamata), "
        f"{n_quote} solo quote, {n_full} download completo.",
        flush=True,
    )
    return results


def main() -> None:
    with open(os.path.join(DATA_DIR, "biotech_symbols.json"), encoding="utf-8") as f:
        symbols = json.load(f)
    if not isinstance(symbols, list):
        symbols = list(symbols) if symbols else []
    records = run_fetch(symbols)
    save_outputs(records)
    print(">>> YFINANCE COMPLETATO (CACHE INCREMENTALE) <<<")
    print(f"Ticker in output: {len(records)}")


if __name__ == "__main__":
    main()
