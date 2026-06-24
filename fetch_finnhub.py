"""
fetch_finnhub.py
Scarica da Finnhub: quotazione intraday, target analisti, profilo azienda.
Ottimizzazioni:
  - Legge yf.json: salta profile per ticker già coperti da yfinance (risparmia ~1/3 delle chiamate)
  - Ogni ticker esegue le chiamate necessarie in parallelo (HTTP latency sovrapposta)
  - Rate limiter globale: default 60 call/min (tetto Finnhub free); override
    ``FINNHUB_CALLS_PER_MIN`` per piani con quota maggiore (es. 300).
  - 8 worker nel pool esterno per massimo pipelining
  - Cache: profilo 24h, quote 2h, target 24h
"""

import os
import json
import sys
import time
import threading
import requests
import pandas as pd
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(it, **kw): return it

# Console Windows (cp1252): evita crash Unicode nei log.
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

DATA_DIR = "data"

PROFILE_CACHE_DIR = os.path.join(DATA_DIR, "finnhub_profile_cache")
QUOTE_CACHE_DIR   = os.path.join(DATA_DIR, "finnhub_quote_cache")
TARGET_CACHE_DIR  = os.path.join(DATA_DIR, "finnhub_target_cache")

OUTPUT_JSON_PATH = os.path.join(DATA_DIR, "finnhub.json")
OUTPUT_XLSX_PATH = os.path.join(DATA_DIR, "finnhub.xlsx")
YF_JSON_PATH     = os.path.join(DATA_DIR, "yf.json")

for _d in [PROFILE_CACHE_DIR, QUOTE_CACHE_DIR, TARGET_CACHE_DIR, DATA_DIR]:
    os.makedirs(_d, exist_ok=True)

PROFILE_TTL_HOURS = 24
QUOTE_TTL_HOURS   = 2
TARGET_TTL_HOURS  = 24

FINNHUB_API_KEY    = "d7jh0jpr01qhf13er8bgd7jh0jpr01qhf13er8c0"
MAX_WORKERS        = 8    # pool esterno: ticker × endpoint in parallelo


def _finnhub_rate_limit_per_min() -> int:
    """Chiamate API consentite per finestra scorrevole di 60 s (Finnhub free = 60/min)."""
    raw = os.environ.get("FINNHUB_CALLS_PER_MIN", "").strip()
    if raw:
        try:
            n = int(raw)
            return max(1, min(n, 5000))
        except ValueError:
            pass
    return 60


RATE_LIMIT_PER_MIN = _finnhub_rate_limit_per_min()


# ─── Rate limiter globale (token-bucket a finestra scorrevole 60 s) ──────────

_rate_lock  = threading.Lock()
_call_times = []   # timestamp di ogni chiamata API nell'ultimo minuto


def _rate_limited_call(fn):
    """Esegue fn() rispettando RATE_LIMIT_PER_MIN chiamate al minuto."""
    while True:
        with _rate_lock:
            now = time.time()
            _call_times[:] = [t for t in _call_times if now - t < 60.0]
            if len(_call_times) < RATE_LIMIT_PER_MIN:
                _call_times.append(now)
                break
        # Finestra piena: aspetta che la chiamata più vecchia scada
        with _rate_lock:
            oldest = _call_times[0] if _call_times else now
        time.sleep(max(0.05, 60.0 - (time.time() - oldest) + 0.1))
    return fn()


# ─── Cache helpers ───────────────────────────────────────────────────────────

def _cache_path(cache_dir, symbol):
    return os.path.join(cache_dir, f"{symbol}.json")


def _is_fresh(path, ttl_hours):
    if not os.path.exists(path):
        return False
    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    return (datetime.now() - mtime) <= timedelta(hours=ttl_hours)


def _load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


# ─── API wrapper ─────────────────────────────────────────────────────────────

def _api(endpoint, symbol):
    url = f"https://finnhub.io/api/v1/{endpoint}"
    try:
        r = requests.get(url, params={"symbol": symbol, "token": FINNHUB_API_KEY}, timeout=10)
        return r.json()
    except Exception:
        return {}


# ─── Caricamento yf.json come hot-cache ──────────────────────────────────────

def _load_yf_lookup():
    """Restituisce un dict {SYMBOL: row_dict} da yf.json, o {} se non disponibile."""
    if not os.path.exists(YF_JSON_PATH):
        return {}
    try:
        data = json.load(open(YF_JSON_PATH, "r", encoding="utf-8"))
    except Exception:
        return {}
    lookup = {}
    for row in (data if isinstance(data, list) else []):
        if isinstance(row, dict):
            sym = (row.get("symbol") or row.get("ticker") or "").strip().upper()
            if sym:
                lookup[sym] = row
    return lookup


def _yf_has_profile(yf_row):
    """True se yfinance ha già i dati di profilo essenziali per questo ticker."""
    if not yf_row:
        return False
    return bool(yf_row.get("companyName") or yf_row.get("longName") or yf_row.get("shortName"))


# ─── Fetch singolo simbolo ────────────────────────────────────────────────────
#
# Strategia per ogni endpoint:
#   1. Cache fresca  → legge da file, nessuna API call
#   2. yf copre quel campo (solo per profile) → salta API call, usa dati yf
#   3. Altrimenti     → chiama API (rate-limited)
#
# Le tre chiamate (profile, quote, target) vengono inviate come task indipendenti
# dal pool esterno (MAX_WORKERS) quindi si sovrappongono per ticker diversi.
# Dentro fetch_symbol usiamo un sotto-pool da 3 per sovrapporre anche le chiamate
# dello stesso ticker quando necessario.

def fetch_symbol(symbol, yf_lookup):
    symbol = symbol.upper().strip()
    yf_row = yf_lookup.get(symbol, {})

    prof_path = _cache_path(PROFILE_CACHE_DIR, symbol)
    quot_path = _cache_path(QUOTE_CACHE_DIR,   symbol)
    tgt_path  = _cache_path(TARGET_CACHE_DIR,  symbol)

    # Determina cosa deve essere fetchato via API (non in cache fresca)
    need_profile = not _is_fresh(prof_path, PROFILE_TTL_HOURS) and not _yf_has_profile(yf_row)
    need_quote   = not _is_fresh(quot_path, QUOTE_TTL_HOURS)
    need_target  = not _is_fresh(tgt_path,  TARGET_TTL_HOURS)

    # Se non serve nulla, ritorna subito
    if not need_profile and not need_quote and not need_target:
        prof = _load_json(prof_path) or {}
        quot = _load_json(quot_path) or {}
        tgt  = _load_json(tgt_path)  or {}
        return _build_row(symbol, prof, quot, tgt, yf_row)

    # Lancia le chiamate necessarie in parallelo (sotto-pool da 3)
    results_ep = {}
    calls = {}
    if need_profile:
        calls["profile"] = lambda: _rate_limited_call(lambda: _api("stock/profile2", symbol))
    if need_quote:
        calls["quote"]   = lambda: _rate_limited_call(lambda: _api("quote", symbol))
    if need_target:
        calls["target"]  = lambda: _rate_limited_call(lambda: _api("stock/price-target", symbol))

    with ThreadPoolExecutor(max_workers=min(3, len(calls))) as inner:
        ep_futures = {ep: inner.submit(fn) for ep, fn in calls.items()}
        for ep, fut in ep_futures.items():
            try:
                data = fut.result()
                results_ep[ep] = data
                # Salva in cache
                path_map = {"profile": prof_path, "quote": quot_path, "target": tgt_path}
                _save_json(path_map[ep], data)
            except Exception:
                results_ep[ep] = {}

    # Carica dalla cache i dati non ri-fetchati
    prof = results_ep.get("profile") or _load_json(prof_path) or {}
    quot = results_ep.get("quote")   or _load_json(quot_path) or {}
    tgt  = results_ep.get("target")  or _load_json(tgt_path)  or {}

    return _build_row(symbol, prof, quot, tgt, yf_row)


def _build_row(symbol, prof, quot, tgt, yf_row=None):
    yf = yf_row or {}
    # Profile: Finnhub, con fallback a yfinance per i campi comuni
    company_name = (prof.get("name") or prof.get("companyName")
                    or yf.get("companyName") or yf.get("longName") or yf.get("shortName"))
    exchange     = prof.get("exchange") or yf.get("exchange")
    country      = prof.get("country")  or yf.get("country")
    currency     = prof.get("currency") or yf.get("currency")
    market_cap   = prof.get("marketCapitalization") or yf.get("marketCap")
    return {
        "symbol":          symbol,
        "companyName":     company_name,
        "ticker":          prof.get("ticker", symbol),
        "exchange":        exchange,
        "country":         country,
        "currency":        currency,
        "marketCap":       market_cap,
        "weburl":          prof.get("weburl"),
        "ipo":             prof.get("ipo"),
        "logo":            prof.get("logo"),
        "finnhubIndustry": prof.get("finnhubIndustry"),
        # Quote (intraday)
        "currentPrice":    quot.get("c"),
        "change":          quot.get("d"),
        "percentChange":   quot.get("dp"),
        "highPrice":       quot.get("h"),
        "lowPrice":        quot.get("l"),
        "openPrice":       quot.get("o"),
        "prevClose":       quot.get("pc"),
        # Analyst targets
        "targetHigh":      tgt.get("targetHigh"),
        "targetLow":       tgt.get("targetLow"),
        "targetMean":      tgt.get("targetMean"),
        "targetMedian":    tgt.get("targetMedian"),
        "targetPrice":     tgt.get("targetMean"),
    }


# ─── Caricamento simboli da yf.json ──────────────────────────────────────────

def _load_symbols(yf_lookup):
    if not os.path.exists(YF_JSON_PATH):
        return []
    try:
        data = json.load(open(YF_JSON_PATH, "r", encoding="utf-8"))
    except Exception:
        return []
    symbols = []
    for row in (data if isinstance(data, list) else []):
        if isinstance(row, dict):
            sym = (row.get("symbol") or row.get("ticker") or "").strip().upper()
            if sym:
                symbols.append(sym)
    return sorted(set(symbols))


# ─── Salvataggio output ───────────────────────────────────────────────────────

def save_outputs(results):
    _save_json(OUTPUT_JSON_PATH, results)

    df = pd.DataFrame(results)
    preferred_cols = [
        "symbol", "companyName", "ticker", "exchange", "country", "currency",
        "marketCap", "finnhubIndustry", "currentPrice", "change", "percentChange",
        "highPrice", "lowPrice", "openPrice", "prevClose",
        "targetHigh", "targetLow", "targetMean", "targetMedian", "targetPrice",
        "weburl", "ipo", "logo",
    ]
    cols = [c for c in preferred_cols if c in df.columns] + [
        c for c in df.columns if c not in preferred_cols
    ]
    df = df[cols]

    with pd.ExcelWriter(OUTPUT_XLSX_PATH, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Finnhub")

    print(f"Salvato JSON:  {OUTPUT_JSON_PATH}")
    print(f"Salvato Excel: {OUTPUT_XLSX_PATH}")
    print(f"Ticker processati: {len(results)}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    yf_lookup = _load_yf_lookup()

    if len(sys.argv) >= 2:
        symbols = [s.strip().upper() for s in sys.argv[1:] if s.strip()]
    else:
        symbols = _load_symbols(yf_lookup)

    if not symbols:
        print("Nessun simbolo trovato in yf.json.")
        raise SystemExit(1)

    # Statistiche pre-fetch
    fully_cached = sum(
        1 for s in symbols
        if (_is_fresh(_cache_path(PROFILE_CACHE_DIR, s), PROFILE_TTL_HOURS) or _yf_has_profile(yf_lookup.get(s)))
        and _is_fresh(_cache_path(QUOTE_CACHE_DIR, s), QUOTE_TTL_HOURS)
        and _is_fresh(_cache_path(TARGET_CACHE_DIR, s), TARGET_TTL_HOURS)
    )
    yf_skip_profile = sum(
        1 for s in symbols
        if _yf_has_profile(yf_lookup.get(s))
        and not _is_fresh(_cache_path(PROFILE_CACHE_DIR, s), PROFILE_TTL_HOURS)
    )
    stale = len(symbols) - fully_cached

    print(f"[Finnhub] {len(symbols)} ticker - "
          f"{fully_cached} gia in cache, "
          f"{yf_skip_profile} profile saltati (coperti da yfinance), "
          f"{stale} con almeno un endpoint da fetchare")
    print(f"[Finnhub] Limite: {RATE_LIMIT_PER_MIN} call/min "
          f"(env FINNHUB_CALLS_PER_MIN; se 429 HTTP, abbassa il valore)")

    # Stima chiamate API necessarie
    api_calls_needed = 0
    for s in symbols:
        yf_row = yf_lookup.get(s, {})
        if not (_is_fresh(_cache_path(PROFILE_CACHE_DIR, s), PROFILE_TTL_HOURS) or _yf_has_profile(yf_row)):
            api_calls_needed += 1
        if not _is_fresh(_cache_path(QUOTE_CACHE_DIR, s), QUOTE_TTL_HOURS):
            api_calls_needed += 1
        if not _is_fresh(_cache_path(TARGET_CACHE_DIR, s), TARGET_TTL_HOURS):
            api_calls_needed += 1
    if api_calls_needed:
        est_min = max(1, round(api_calls_needed / RATE_LIMIT_PER_MIN))
        print(f"[Finnhub] ~{api_calls_needed} chiamate API necessarie -> stima ~{est_min} min")
    else:
        print("[Finnhub] Tutto in cache - completamento immediato")

    results = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(fetch_symbol, sym, yf_lookup): sym
            for sym in symbols
        }
        for future in tqdm(as_completed(future_map),
                           total=len(future_map),
                           desc="Finnhub",
                           ncols=80):
            sym = future_map[future]
            try:
                results.append(future.result())
            except Exception as e:
                print(f"  [Finnhub] {sym}: errore ({e})")

    save_outputs(results)
    print(">>> FINNHUB COMPLETATO <<<")


if __name__ == "__main__":
    main()
