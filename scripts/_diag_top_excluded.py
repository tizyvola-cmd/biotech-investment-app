"""Diagnostica: perché PBYI, BCAB, OLMA, BNTX, CLRB non sono in Top Opportunità.

Mostra per ogni ticker target tutti i campi rilevanti al filtraggio:
  - Affidabilità (raw, calib)
  - Pred +4, Pred +7, Pred empirica → pred5 interpolato
  - R² fit
  - Inferenza modello
  - Stelle qualità segnale
  - P&L %
  - Slope corrente dal histlib (latest_slope_20d, latest_slope_5d)
  - Cohort quintile (Hit% atteso)
"""
from __future__ import annotations
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TARGETS = ["PBYI", "BCAB", "OLMA", "BNTX", "CLRB"]

SIM = Path("data/simulation_sheet_snapshot.json")
HIST = Path("data/model_historical_input_library.json")
COHORT = Path("data/investment_decision_cohort.json")

sim = json.loads(SIM.read_text(encoding="utf-8"))
cols = sim.get("columns", [])
rows = sim.get("rows", [])
print(f"Sim rows: {len(rows)} · cols: {len(cols)}")
print()

def find_col(*parts: str) -> str:
    for c in cols:
        flat = c.replace("\n", " ")
        if all(p.lower() in flat.lower() for p in parts):
            return c
    return ""

col_aff = find_col("Affidabilit") or "Affidabilità\n%"
col_aff_cal = find_col("Affidabilit", "calib")
col_r2 = find_col("R²") or find_col("R2")
col_pred4 = find_col("Pred", "+4")
col_pred7 = find_col("Pred", "+7")
col_pred_emp = find_col("Pred empirica")
col_infer = find_col("Inferenza")
col_stars = find_col("stelle") or find_col("segnale")
col_pnl_pct = find_col("P&L", "(%)")
col_cap = find_col("Capitale", "Investito")
col_cd = find_col("Completion", "Date")
col_ticker = "Ticker"

print(f"col_aff = {col_aff!r}")
print(f"col_pred4 = {col_pred4!r}")
print(f"col_pred7 = {col_pred7!r}")
print(f"col_pred_emp = {col_pred_emp!r}")
print(f"col_infer = {col_infer!r}")
print(f"col_r2 = {col_r2!r}")
print(f"col_stars = {col_stars!r}")
print()

# Histlib: slope latest by ticker
hist = json.loads(HIST.read_text(encoding="utf-8")) if HIST.is_file() else {}
hist_rows = hist.get("rows", {})
latest = {}
for k, v in hist_rows.items():
    t = k.split("|")[0]
    snaps = v.get("snapshots", {}) if isinstance(v, dict) else {}
    for offs, s in snaps.items():
        if not isinstance(s, dict):
            continue
        s20 = s.get("slope_20d")
        if s20 is None:
            continue
        asof = s.get("close_asof_date") or ""
        if not asof:
            continue
        prev = latest.get(t)
        if prev is None or asof > prev["asof"]:
            latest[t] = {
                "asof": asof,
                "slope_5d": s.get("slope_5d"),
                "slope_20d": s20,
                "run_up_30d": s.get("run_up_30d"),
                "source": k,
                "offset": offs,
            }

# Cohort quintiles
cohort = json.loads(COHORT.read_text(encoding="utf-8")) if COHORT.is_file() else {}
quintiles = cohort.get("quintiles", [])
print("Cohort quintiles (Affidabilità → Hit% atteso):")
for q in quintiles:
    print(f"  {q.get('label')}: aff [{q.get('affidabilita_min')}..{q.get('affidabilita_max')}] "
          f"hit={q.get('hit_rate_pct')}% n={q.get('n')}")
print()


def num(v):
    if v is None or v == "" or v == "—":
        return None
    if isinstance(v, str):
        s = v.strip().replace(",", ".").replace("%", "")
        if not s or s in ("n/d", "N/D"):
            return None
        try:
            return float(s)
        except ValueError:
            return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_pp(v, raw):
    """Converte frazione decimale → percentuale se |v|<=1.5 e non ha già % nel raw string."""
    if v is None:
        return None
    has_pct = isinstance(raw, str) and "%" in raw
    return v * 100 if abs(v) <= 1.5 and not has_pct else v


def find_quintile(aff_pct):
    if aff_pct is None:
        return None
    for q in quintiles:
        lo = q.get("affidabilita_min")
        hi = q.get("affidabilita_max")
        if lo is None or hi is None:
            continue
        if lo <= aff_pct <= hi:
            return q
    return None


for ticker in TARGETS:
    matches = [r for r in rows if str(r.get(col_ticker, "")).strip().upper() == ticker]
    if not matches:
        print(f"\n=== {ticker} ===")
        print("  Non trovato nel snapshot Simulation")
        continue
    r = matches[0]
    print(f"\n=== {ticker} ===")
    cd = r.get(col_cd, "")
    cap = num(r.get(col_cap))
    pnl_pct = num(r.get(col_pnl_pct))
    if pnl_pct is not None and abs(pnl_pct) <= 1.5:
        pnl_pct *= 100
    aff_raw = num(r.get(col_aff))
    aff_cal = num(r.get(col_aff_cal)) if col_aff_cal else None
    aff_pct = aff_cal if aff_cal is not None else aff_raw
    if aff_pct is not None and aff_pct <= 1.5:
        aff_pct *= 100
    r2 = num(r.get(col_r2))
    pred4 = to_pp(num(r.get(col_pred4)), r.get(col_pred4))
    pred7 = to_pp(num(r.get(col_pred7)), r.get(col_pred7))
    pred_emp = to_pp(num(r.get(col_pred_emp)), r.get(col_pred_emp))
    # pred5 con interpolazione (stessa logica UI)
    if pred4 is not None and pred7 is not None:
        pred5 = pred4 + (pred7 - pred4) * (1/3)
    elif pred7 is not None:
        pred5 = pred7
    elif pred4 is not None:
        pred5 = pred4
    else:
        pred5 = pred_emp
    infer = r.get(col_infer, "") if col_infer else ""
    stars = r.get(col_stars, "") if col_stars else ""

    slope = latest.get(ticker, {})

    print(f"  CD: {cd}")
    print(f"  Capitale: {cap}€")
    print(f"  P&L: {pnl_pct}%")
    print(f"  Affidabilità: raw={aff_raw} | calib={aff_cal} | usato={aff_pct}%")
    print(f"  R² fit: {r2}")
    print(f"  Pred +4: {pred4}pp | Pred +7: {pred7}pp → Pred +5 interpolato: {pred5}pp")
    print(f"  Pred empirica: {pred_emp}pp")
    print(f"  Inferenza: {infer!r}")
    print(f"  Stelle: {stars!r}")
    if slope:
        print(f"  Slope (histlib): slope_5d={slope.get('slope_5d')} slope_20d={slope.get('slope_20d')} "
              f"run_up_30d={slope.get('run_up_30d')}% asof={slope.get('asof')} ({slope.get('offset')})")
    else:
        print(f"  Slope (histlib): NESSUN DATO per {ticker}")

    # Quintile match
    q = find_quintile(aff_pct)
    if q:
        print(f"  Quintile Aff: {q.get('label')} → Hit% atteso = {q.get('hit_rate_pct')}% (n={q.get('n')})")
    else:
        print(f"  Quintile Aff: NESSUNA CORRISPONDENZA")

    # ── Diagnosi filtri Top Opportunità ────────────────────────────────────
    print(f"\n  ── DIAGNOSI FILTRI Top Opportunità ──")
    issues = []
    # Filtro Affidabilità minima (default UI = 70)
    if aff_pct is None:
        issues.append(f"❌ Affidabilità mancante")
    elif aff_pct < 70:
        issues.append(f"❌ Aff {aff_pct:.0f}% < soglia UI 70% (modificabile, ma con <85% il modello ha edge debole)")
    else:
        print(f"  ✓ Aff {aff_pct:.0f}% ≥ 70%")
    # Pred +5 minimo (default UI = 0.5pp)
    if pred5 is None:
        issues.append(f"❌ Pred +5 mancante")
    elif pred5 < 0.5:
        issues.append(f"❌ Pred +5 {pred5:.2f}pp < soglia UI 0.5pp (curva pred non vede rialzo)")
    else:
        print(f"  ✓ Pred +5 {pred5:.2f}pp ≥ 0.5pp")
    # Filtro qualità rigoroso (Hit% atteso)
    hit = q.get("hit_rate_pct") if q else None
    if hit is None:
        issues.append(f"❌ Hit% atteso mancante (no quintile)")
    elif hit < 45:
        issues.append(f"❌ Hit% atteso {hit}% < 45% (sotto random)")
    elif 45 <= hit <= 55:
        issues.append(f"⚠ Hit% atteso {hit}% in random zone [45-55]")
    else:
        print(f"  ✓ Hit% atteso {hit}% fuori dalla random zone")
    if issues:
        print("  PROBLEMI:")
        for i in issues:
            print(f"    {i}")
    else:
        print("  ✓ Tutti i filtri base superati — verifica Filtro qualità rigoroso (stabilityVerdict)")

print()
print("== Defaults UI ==")
print("  upsidePredThreshold:  0.5pp (modificabile)")
print("  expectedHitThreshold: 0.0 di default → filtro qualità rigoroso ON esclude hit<45 e random zone")
print("  minAffidabilita:      70% di default (modificabile, consigliato 85% per edge solido)")
