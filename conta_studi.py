"""
conta_studi.py
==============
Script di diagnostica: stima quanti studi passati (Exact) hanno dati
sufficienti per la coorte usata dal foglio «Accuracy» (ex Accuratezza Simulation).

Come eseguire (nella cartella di progetto):
    python conta_studi.py

Non modifica nulla, non genera output Excel.
"""

import os
import sys
from datetime import date as _date, datetime

# ── Dipendenze ────────────────────────────────────────────────────────────────
try:
    import pandas as pd
except ImportError:
    sys.exit("Installa pandas:  pip install pandas openpyxl")

try:
    import yfinance as yf
except ImportError:
    sys.exit("Installa yfinance: pip install yfinance")

# ── Costanti (stesse di data_orchestrator.py) ─────────────────────────────────
DATA_DIR      = "data"
CLINICAL_XLSX = os.path.join(DATA_DIR, "biotech_clinical_openfda.xlsx")
TODAY         = _date.today()

# ── Carica il file clinico ────────────────────────────────────────────────────
if not os.path.exists(CLINICAL_XLSX):
    sys.exit(f"File non trovato: {CLINICAL_XLSX}\n"
             f"Assicurati di essere nella cartella del progetto.")

print(f"[Lettura] {CLINICAL_XLSX} …")
df = pd.read_excel(CLINICAL_XLSX, engine="openpyxl")
print(f"  → {len(df)} righe totali, {len(df.columns)} colonne")

# ── Trova le colonne chiave ────────────────────────────────────────────────────
def _find(candidates, cols):
    cols_l = [c.lower() for c in cols]
    for cand in candidates:
        if cand.lower() in cols_l:
            return cols[cols_l.index(cand.lower())]
    return None

cols = list(df.columns)
ticker_col  = _find(["ticker", "symbol"], cols)
date_col    = _find(["primary_completion_date", "completion_date",
                     "study_completion_date", "end_date"], cols)
sponsor_col = _find(["sponsor_match"], cols)

print(f"\n[Colonne trovate]")
print(f"  Ticker  : {ticker_col or 'NON TROVATA'}")
print(f"  Data    : {date_col   or 'NON TROVATA'}")
print(f"  Sponsor : {sponsor_col or 'NON TROVATA (tutte le righe saranno incluse)'}")

if not ticker_col or not date_col:
    sys.exit("Colonne essenziali mancanti — verifica il file Excel.")

# ── Filtra righe candidate ────────────────────────────────────────────────────
def _to_date(v):
    if v is None: return None
    if isinstance(v, _date) and not isinstance(v, datetime): return v
    try:
        t = pd.Timestamp(str(v))
        return None if pd.isnull(t) else t.date()
    except: return None

rows = []
for _, row in df.iterrows():
    tk = str(row.get(ticker_col, "")).strip().upper()
    if not tk or tk in ("NAN", "NONE", ""): continue
    cd = _to_date(row.get(date_col))
    if cd is None or cd >= TODAY: continue       # solo studi già completati
    if sponsor_col:
        spon = str(row.get(sponsor_col, "")).strip()
        if spon != "Exact": continue             # solo match confermati
    rows.append({"ticker": tk, "completion_date": cd})

# Coppie uniche (ticker, cd)
seen = set()
unique_pairs = []
for r in rows:
    key = (r["ticker"], r["completion_date"])
    if key not in seen:
        seen.add(key)
        unique_pairs.append(r)

# Raggruppa per ticker
from collections import defaultdict
by_ticker = defaultdict(list)
for r in unique_pairs:
    by_ticker[r["ticker"]].append(r["completion_date"])

print(f"\n{'─'*60}")
print(f"Studi Exact + completion_date passata : {len(unique_pairs)}")
print(f"Ticker unici coinvolti               : {len(by_ticker)}")
print(f"\nDettaglio per ticker (ordinati per n. studi):")
for tk, dates in sorted(by_ticker.items(), key=lambda x: -len(x[1])):
    d_fmt = [str(d) for d in sorted(dates)]
    print(f"  {tk:8s} — {len(dates)} studi: {', '.join(d_fmt)}")

# ── Per ogni ticker unico: controlla data IPO via yfinance ───────────────────
print(f"\n{'─'*60}")
print("Verifica quotazione al momento del catalyst (download yfinance) …")
print("(potrebbe richiedere 20-40 secondi)\n")

n_tutti_ok   = 0   # tutti gli studi del ticker avevano dati sufficienti
n_alcuni_ok  = 0   # almeno uno degli studi del ticker aveva dati
n_nessuno_ok = 0   # ticker non aveva dati in nessuno studio

ipo_cache: dict = {}   # ticker → first_trade_date o None

tickers_list = sorted(by_ticker.keys())

# Download batch
try:
    raw = yf.download(tickers_list, period="5y", auto_adjust=True,
                      group_by="ticker", threads=True, progress=False)
except Exception as e:
    print(f"  Errore download batch: {e}")
    raw = None

# Estrai primo giorno di trading per ogni ticker
for tk in tickers_list:
    try:
        if raw is None:
            raise ValueError("download fallito")
        if len(tickers_list) == 1:
            cls = raw["Close"].dropna() if "Close" in raw else pd.Series()
        else:
            cls = raw["Close"][tk].dropna() if tk in raw["Close"] else pd.Series()
        if cls.empty:
            ipo_cache[tk] = None
        else:
            first_idx = cls.index[0]
            ipo_cache[tk] = (first_idx.date()
                             if hasattr(first_idx, "date") else _to_date(str(first_idx)))
    except:
        ipo_cache[tk] = None

# ── Report per studio ─────────────────────────────────────────────────────────
print(f"{'Ticker':<10} {'Catalyst':<12} {'IPO (≈)':<12} {'gg pre-cat':<12} {'Stato'}")
print("─" * 65)

tot_ok    = 0
tot_warn  = 0
tot_no    = 0
tot_nodata= 0

for r in sorted(unique_pairs, key=lambda x: (x["ticker"], x["completion_date"])):
    tk  = r["ticker"]
    cd  = r["completion_date"]
    ipo = ipo_cache.get(tk)

    if ipo is None:
        stato = "NO DATI"
        tot_nodata += 1
    elif ipo > cd:
        stato = "✗ IPO DOPO catalyst"
        tot_no += 1
    else:
        # Conta giorni di borsa approssimativi (calendario = ~0.71 * giorni cal)
        delta_cal = (cd - ipo).days
        gg_borsa  = int(delta_cal * 0.71)
        if gg_borsa >= 21:
            stato = f"✓ ~{gg_borsa} gg borsa"
            tot_ok += 1
        else:
            stato = f"⚠ solo ~{gg_borsa} gg borsa"
            tot_warn += 1

    print(f"{tk:<10} {str(cd):<12} {str(ipo or 'N/D'):<12} "
          f"{'—' if ipo is None or ipo > cd else str(int((cd-ipo).days*0.71))+'d':<12} "
          f"{stato}")

print(f"\n{'═'*65}")
print(f"TOTALE studi analizzati : {len(unique_pairs)}")
print(f"  ✓ Quotata e dati ok   : {tot_ok:>4}  (≥21 gg borsa pre-catalyst)")
print(f"  ⚠ IPO recente         : {tot_warn:>4}  (<21 gg borsa, dati scarsi)")
print(f"  ✗ Non quotata al T    : {tot_no:>4}  (IPO successivo al catalyst)")
print(f"  ∅ Nessun dato yfinance: {tot_nodata:>4}  (delistato / ticker errato)")
print(f"{'─'*65}")
print(f"  → RECORD ATTENDIBILI IN ACCURATEZZA MODELLO: {tot_ok + tot_warn}")
print(f"     (quelli con ✓ o ⚠ — esclusi ✗ e ∅)")
