"""
check_coverage.py — Verifica copertura dati per ogni ticker

Legge tutte le sorgenti dati prodotte dai fetcher e stampa un report
che mostra per ogni ticker quali dati sono presenti o mancanti,
inclusa la copertura clinica (Clinical_OpenFDA).

Uso:
    python check_coverage.py              → report completo
    python check_coverage.py --missing    → solo ticker con dati mancanti
    python check_coverage.py --csv        → salva anche coverage_report.csv
    python check_coverage.py --clinical   → dettaglio extra sheet clinica
"""

import os
import sys
import json
import time
import argparse
from collections import defaultdict
from datetime import datetime

# ── Percorsi (devono combaciare con quelli dei fetcher) ───────────────────────
DATA_DIR            = "data"
YF_JSON             = os.path.join(DATA_DIR, "yf.json")
FINNHUB_JSON        = os.path.join(DATA_DIR, "finnhub.json")
VARIATIONS_JSON     = os.path.join(DATA_DIR, "variations.json")
CLINICAL_CSV        = os.path.join(DATA_DIR, "biotech_clinical_openfda.csv")
CLINICAL_XLSX       = os.path.join(DATA_DIR, "biotech_clinical_openfda.xlsx")

FH_PROFILE_DIR      = os.path.join(DATA_DIR, "finnhub_profile_cache")
FH_QUOTE_DIR        = os.path.join(DATA_DIR, "finnhub_quote_cache")
FH_TARGET_DIR       = os.path.join(DATA_DIR, "finnhub_target_cache")
VARIATIONS_CACHE    = os.path.join(DATA_DIR, "variations_cache")
ENRICH_CACHE        = os.path.join(DATA_DIR, "enrich_cache")
PRICE_CACHE         = os.path.join(DATA_DIR, "price_cache")

# Colonne YF considerate "core" — se mancano il ticker è rate-limited
YF_CORE_FIELDS      = ["currentPrice", "marketCap", "companyName"]

# Soglie di "vecchiaia" cache (ore)
TTL_FH_PROFILE_H    = 24
TTL_FH_QUOTE_H      = 6
TTL_FH_TARGET_H     = 24
TTL_VARIATIONS_H    = 48
TTL_ENRICH_H        = 24
TTL_PRICE_H         = 24

# Livelli sponsor_match considerati "con dati clinici validi"
CLINICAL_VALID_MATCH = {"Exact", "Partial"}

# ─────────────────────────────────────────────────────────────────────────────

def _age_h(path: str):
    if not os.path.exists(path):
        return None
    return (time.time() - os.path.getmtime(path)) / 3600


def _age_label(h, ttl: float) -> str:
    if h is None:
        return "MANCANTE"
    if h > ttl:
        return f"STALE ({h:.0f}h fa)"
    return f"OK ({h:.0f}h fa)"


def _is_ok(h, ttl: float) -> bool:
    return h is not None and h <= ttl


def _load_json(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  [WARN] Impossibile leggere {path}: {e}")
        return {}


def _load_clinical_df():
    """Carica il CSV clinico. Ritorna None se non disponibile."""
    try:
        import pandas as pd
    except ImportError:
        print("  [WARN] pandas non disponibile — sezione clinica saltata.")
        return None

    for path, reader in [(CLINICAL_CSV, pd.read_csv),
                         (CLINICAL_XLSX, pd.read_excel)]:
        if os.path.exists(path):
            try:
                df = reader(path, dtype=str)
                df.columns = [c.strip() for c in df.columns]
                age_h = _age_h(path)
                age_str = f"{age_h:.0f}h fa" if age_h is not None else "?"
                print(f"  File clinico: {path}  ({age_str})")
                return df
            except Exception as e:
                print(f"  [WARN] Impossibile leggere {path}: {e}")
    print(f"  [WARN] Nessun file clinico trovato "
          f"({CLINICAL_CSV} o {CLINICAL_XLSX}) — esegui fetch_biotech.py")
    return None


def _build_clinical_index(df) -> dict:
    """
    Costruisce {ticker_upper: {"count": N, "exact": N, "partial": N,
                               "no_match": N, "nd": N, "no_ticker": N}}
    """
    ticker_col = next((c for c in ["ticker", "Ticker", "symbol", "Symbol"]
                       if c in df.columns), None)
    match_col  = next((c for c in ["sponsor_match", "Sponsor_match",
                                   "sponsorMatch"]
                       if c in df.columns), None)

    index = defaultdict(lambda: {
        "count": 0, "exact": 0, "partial": 0,
        "no_match": 0, "nd": 0, "no_ticker_rows": 0
    })
    no_ticker_total = 0

    for _, row in df.iterrows():
        tk_raw = str(row.get(ticker_col, "") if ticker_col else "").strip()
        match  = str(row.get(match_col,  "") if match_col  else "").strip()

        if not tk_raw or tk_raw.lower() in ("nan", "none", ""):
            no_ticker_total += 1
            continue

        tk = tk_raw.upper()
        index[tk]["count"] += 1
        if   match == "Exact":    index[tk]["exact"]    += 1
        elif match == "Partial":  index[tk]["partial"]  += 1
        elif match == "No match": index[tk]["no_match"] += 1
        else:                     index[tk]["nd"]       += 1

    return dict(index), no_ticker_total, ticker_col, match_col


# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Verifica copertura dati per ogni ticker")
    parser.add_argument("--missing",  action="store_true",
                        help="Mostra solo ticker con dati mancanti/stale")
    parser.add_argument("--csv",      action="store_true",
                        help="Salva coverage_report.csv")
    parser.add_argument("--clinical", action="store_true",
                        help="Mostra dettaglio completo sheet clinica")
    args = parser.parse_args()

    print("=" * 76)
    print("  CHECK COVERAGE — Verifica copertura dati per ogni ticker")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 76)

    # ── 1. Carica universo ticker da yf.json ─────────────────────────────────
    yf_data = _load_json(YF_JSON)
    if not yf_data:
        print(f"\n[ERRORE] {YF_JSON} non trovato — esegui prima fetch_yfinance.py")
        sys.exit(1)

    all_tickers = sorted(yf_data.keys())
    n = len(all_tickers)
    print(f"\nUniverse finanziario: {n} ticker da {YF_JSON}\n")

    # ── 2. Carica aggregati Finnhub e Variations ──────────────────────────────
    fh_data  = _load_json(FINNHUB_JSON)
    var_data = _load_json(VARIATIONS_JSON)
    if isinstance(var_data, list):
        var_set = {str(r.get("ticker") or r.get("symbol", "")).upper()
                   for r in var_data
                   if r.get("ticker") or r.get("symbol")}
    else:
        var_set = set(var_data.keys())

    # ── 3. Carica dati clinici ────────────────────────────────────────────────
    print("Caricamento dati clinici…")
    clinical_df = _load_clinical_df()
    if clinical_df is not None:
        clinical_index, clinical_no_tk, tk_col, match_col = \
            _build_clinical_index(clinical_df)
        clinical_total_rows = len(clinical_df)
        print(f"  Righe totali: {clinical_total_rows}  |  "
              f"Ticker unici in clinical: {len(clinical_index)}  |  "
              f"Righe senza ticker: {clinical_no_tk}\n")
    else:
        clinical_index = {}
        clinical_total_rows = clinical_no_tk = 0
        tk_col = match_col = None

    # ── 4. Per ogni ticker costruisci il record di copertura ─────────────────
    records = []
    counters = {
        "yf_ok": 0, "yf_ratelim": 0, "yf_missing": 0,
        "fh_profile_ok": 0, "fh_quote_ok": 0, "fh_target_ok": 0,
        "var_ok": 0, "enrich_ok": 0, "price_ok": 0,
        "clin_exact": 0, "clin_partial": 0,
        "clin_nomatch": 0, "clin_absent": 0,
        "fully_covered": 0, "partial": 0, "empty": 0,
    }

    for tk in all_tickers:
        row = yf_data.get(tk, {})

        # ── YF ───────────────────────────────────────────────────────────────
        yf_has_core = all(row.get(f) for f in YF_CORE_FIELDS)
        yf_has_any  = bool(row)
        if yf_has_core:
            yf_status = "OK"
            counters["yf_ok"] += 1
        elif yf_has_any:
            miss = [f for f in YF_CORE_FIELDS if not row.get(f)]
            yf_status = f"PARZIALE (manca: {', '.join(miss)})"
            counters["yf_ratelim"] += 1
        else:
            yf_status = "MANCANTE"
            counters["yf_missing"] += 1

        # ── Finnhub ──────────────────────────────────────────────────────────
        fh_prof_age = _age_h(os.path.join(FH_PROFILE_DIR, f"{tk}.json"))
        fh_quot_age = _age_h(os.path.join(FH_QUOTE_DIR,   f"{tk}.json"))
        fh_tgt_age  = _age_h(os.path.join(FH_TARGET_DIR,  f"{tk}.json"))
        fh_prof_ok  = _is_ok(fh_prof_age, TTL_FH_PROFILE_H)
        fh_quot_ok  = _is_ok(fh_quot_age, TTL_FH_QUOTE_H)
        fh_tgt_ok   = _is_ok(fh_tgt_age,  TTL_FH_TARGET_H)
        if fh_prof_ok: counters["fh_profile_ok"] += 1
        if fh_quot_ok: counters["fh_quote_ok"] += 1
        if fh_tgt_ok:  counters["fh_target_ok"] += 1

        missing_fh = (
            ([] if fh_prof_ok else ["profile"]) +
            ([] if fh_quot_ok else ["quote"]) +
            ([] if fh_tgt_ok  else ["target"])
        )
        fh_status = ("OK" if not missing_fh
                     else f"manca: {', '.join(missing_fh)}")

        # ── Variations ────────────────────────────────────────────────────────
        var_cache_age = _age_h(os.path.join(VARIATIONS_CACHE, f"{tk}.json"))
        var_in_json   = tk in var_set
        var_ok        = var_in_json or _is_ok(var_cache_age, TTL_VARIATIONS_H)
        if var_ok: counters["var_ok"] += 1
        var_status    = ("OK (json)" if var_in_json
                         else _age_label(var_cache_age, TTL_VARIATIONS_H))

        # ── Enrich / Price ────────────────────────────────────────────────────
        enrich_age = _age_h(os.path.join(ENRICH_CACHE, f"{tk}.json"))
        enrich_ok  = _is_ok(enrich_age, TTL_ENRICH_H)
        if enrich_ok: counters["enrich_ok"] += 1

        safe_tk   = tk.replace("^", "_IDX_").replace("/", "_")
        price_age = _age_h(os.path.join(PRICE_CACHE, f"{safe_tk}_5y.pkl"))
        price_ok  = _is_ok(price_age, TTL_PRICE_H)
        if price_ok: counters["price_ok"] += 1

        # ── Clinical ─────────────────────────────────────────────────────────
        clin = clinical_index.get(tk)
        if clin is None:
            clin_status  = "ASSENTE"
            clin_exact   = clin_partial = clin_nm = clin_nd = clin_total = 0
            counters["clin_absent"] += 1
        else:
            clin_total   = clin["count"]
            clin_exact   = clin["exact"]
            clin_partial = clin["partial"]
            clin_nm      = clin["no_match"]
            clin_nd      = clin["nd"]
            if clin_exact:
                clin_status = f"Exact×{clin_exact}"
                if clin_partial: clin_status += f" + Partial×{clin_partial}"
                counters["clin_exact"] += 1
            elif clin_partial:
                clin_status = f"Partial×{clin_partial}"
                counters["clin_partial"] += 1
            elif clin_nm:
                clin_status = f"No match×{clin_nm}"
                counters["clin_nomatch"] += 1
            else:
                clin_status = f"N/D×{clin_nd}"
                counters["clin_absent"] += 1

        # ── Sintesi completezza ───────────────────────────────────────────────
        any_issue = not (yf_has_core and fh_quot_ok)
        if not any_issue:
            counters["fully_covered"] += 1
        elif yf_has_any or fh_quot_ok:
            counters["partial"] += 1
        else:
            counters["empty"] += 1

        records.append({
            "ticker":      tk,
            "yf":          yf_status,
            "fh":          fh_status,
            "variations":  var_status,
            "enrich":      _age_label(enrich_age, TTL_ENRICH_H),
            "price_5y":    _age_label(price_age,  TTL_PRICE_H),
            "clinical":    clin_status,
            "clin_total":  clin_total,
            "clin_exact":  clin_exact,
            "clin_partial":clin_partial,
            # flag interni
            "yf_has_core": yf_has_core,
            "fh_quot_ok":  fh_quot_ok,
            "clin_valid":  clin_exact > 0 or clin_partial > 0,
        })

    # ── 5. Riepilogo FINANZIARIO ──────────────────────────────────────────────
    print("─" * 76)
    print("RIEPILOGO COPERTURA FINANZIARIA")
    print("─" * 76)
    print(f"  Totale ticker:             {n}")
    print()
    print(f"  yfinance core OK:          {counters['yf_ok']:>4} / {n}  "
          f"({counters['yf_ok']/n*100:.1f}%)")
    print(f"  yfinance parziale (RL):    {counters['yf_ratelim']:>4} / {n}")
    print(f"  yfinance totalmente ∅:     {counters['yf_missing']:>4} / {n}")
    print()
    print(f"  Finnhub profile (fresco):  {counters['fh_profile_ok']:>4} / {n}  "
          f"({counters['fh_profile_ok']/n*100:.1f}%)")
    print(f"  Finnhub quote   (fresco):  {counters['fh_quote_ok']:>4} / {n}  "
          f"({counters['fh_quote_ok']/n*100:.1f}%)")
    print(f"  Finnhub target  (fresco):  {counters['fh_target_ok']:>4} / {n}  "
          f"({counters['fh_target_ok']/n*100:.1f}%)")
    print()
    print(f"  Variations (json+cache):   {counters['var_ok']:>4} / {n}  "
          f"({counters['var_ok']/n*100:.1f}%)")
    print(f"  Enrich cache (fresco):     {counters['enrich_ok']:>4} / {n}  "
          f"({counters['enrich_ok']/n*100:.1f}%)")
    print(f"  Price cache 5y (fresco):   {counters['price_ok']:>4} / {n}  "
          f"({counters['price_ok']/n*100:.1f}%)")

    # ── 6. Riepilogo CLINICO ──────────────────────────────────────────────────
    print()
    print("─" * 76)
    print("RIEPILOGO COPERTURA CLINICA  (biotech_clinical_openfda)")
    print("─" * 76)
    if clinical_df is not None:
        clin_covered = counters["clin_exact"] + counters["clin_partial"]
        print(f"  Ticker con studi Exact:    {counters['clin_exact']:>4} / {n}  "
              f"({counters['clin_exact']/n*100:.1f}%)")
        print(f"  Ticker con studi Partial:  {counters['clin_partial']:>4} / {n}  "
              f"({counters['clin_partial']/n*100:.1f}%)")
        print(f"  Ticker con solo No match:  {counters['clin_nomatch']:>4} / {n}")
        print(f"  Ticker ASSENTI in clinical:{counters['clin_absent']:>4} / {n}  "
              f"({counters['clin_absent']/n*100:.1f}%)  ← nessuno studio trovato")
        print()
        # Ticker in clinical ma NON in yf.json
        orphan_tk = sorted(set(clinical_index.keys()) - set(all_tickers))
        if orphan_tk:
            print(f"  Ticker in clinical ma NON in Financial ({len(orphan_tk)}):")
            print(f"    {', '.join(orphan_tk)}")
            print(f"    → probabilmente ticker non più nella watch-list")
        else:
            print("  Tutti i ticker clinici sono presenti anche in Financial.  ✓")
    else:
        print("  (file clinico non disponibile)")

    # ── 7. Ticker senza studi clinici ─────────────────────────────────────────
    absent_clinical = [r["ticker"] for r in records if not r["clin_valid"]]
    if absent_clinical and (args.clinical or args.missing):
        print(f"\nTICKER SENZA STUDI CLINICI VALIDI (Exact/Partial) — "
              f"{len(absent_clinical)}:")
        cols = 8
        for i in range(0, len(absent_clinical), cols):
            print("  " + "  ".join(f"{t:<8}" for t in absent_clinical[i:i+cols]))

    # ── 8. Ticker con problemi finanziari ─────────────────────────────────────
    problems = [r for r in records
                if not r["yf_has_core"] or not r["fh_quot_ok"]]

    if problems:
        print(f"\n{'─'*76}")
        print(f"TICKER CON DATI FINANZIARI MANCANTI/PARZIALI — "
              f"{len(problems)} su {n}")
        header = (f"  {'TICKER':<10}  {'yfinance':<38}  "
                  f"{'Finnhub':<26}  {'Clinical'}")
        print(header)
        print("  " + "-" * (len(header) - 2))
        for r in problems:
            print(f"  {r['ticker']:<10}  {r['yf']:<38}  "
                  f"{r['fh']:<26}  {r['clinical']}")
    else:
        print(f"\n  ✓ Tutti i ticker hanno yfinance core + Finnhub quote.")

    # ── 9. CSV opzionale ─────────────────────────────────────────────────────
    if args.csv:
        import csv
        csv_path = "coverage_report.csv"
        fieldnames = ["ticker", "yf", "fh", "variations",
                      "enrich", "price_5y", "clinical",
                      "clin_total", "clin_exact", "clin_partial"]
        with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(records)
        print(f"\n[CSV] Report salvato in {csv_path}  "
              f"(apribile direttamente in Excel)")

    # ── 10. Suggerimenti finali ────────────────────────────────────────────────
    print("\n" + "=" * 76)
    print("SUGGERIMENTI:")
    print("  yfinance PARZIALE  → rate-limited. Rilanciare fetch_yfinance.py")
    print("  Finnhub MANCANTE   → controllare API key o rilanciare fetch_finnhub.py")
    print("  Variations MANCANTE→ rilanciare fetch_variations.py")
    print("  Clinical ASSENTE   → la società non ha studi in ClinicalTrials.gov")
    print("                       oppure il nome non è stato abbinato (sponsor mismatch)")
    print("  Price 5y MANCANTE  → verrà scaricato automaticamente al prossimo run")
    if args.clinical:
        print("\n  Per vedere le società clinical senza ticker corrispondente:")
        print("    python check_coverage.py --clinical --csv")
    print("=" * 76)


if __name__ == "__main__":
    main()
