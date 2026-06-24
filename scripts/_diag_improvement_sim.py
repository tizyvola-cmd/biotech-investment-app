"""
Simula l'impatto reale del nuovo filtro T>15gg / T>30gg.
Risponde a: di quanto migliora il modello con la nuova soglia?

Metodologia:
- Prende TUTTE le predizioni storiche con actual + aff>0
- Identifica quelle che il NUOVO modello cambierebbe (dir->Stabile)
- Valuta ENTRAMBE le versioni e confronta hit%
"""
import json, sys, io, os, math
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data/past_catalyst_predictions.json"), encoding="utf-8") as f:
    doc = json.load(f)
raw = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

def get_actual(r):
    for k in ("d3_pct","d5_pct","d3_actual","d5_actual"):
        v = r.get(k)
        if v is not None:
            try: return float(v)
            except: pass
    return None

def fn(v):
    try: return float(v) if v is not None else None
    except: return None

def eval_dir(d: str, actual: float):
    """Valuta se la predizione direzionale era corretta."""
    if not d: return None
    if d.startswith("↑"): return actual > 0
    if d.startswith("↓"): return actual < 0
    if d.startswith("→") or "Stab" in d: return abs(actual) < 5.0
    return None

work = [r for r in rows if get_actual(r) is not None and int(r.get("affidabilita",0) or 0) > 0]
print(f"Pool analizzato: {len(work)} record (actual + aff>0)\n")

# ── Classificazione per tipo predizione ───────────────────────────────────────
OLD_hit = OLD_miss = 0
NEW_hit = NEW_miss = 0

changed_count = 0
changed_better = changed_worse = changed_same = 0

# Dettagli per fascia days
by_days_old  = defaultdict(lambda: [0,0])  # hits, misses
by_days_new  = defaultdict(lambda: [0,0])

stabile_threshold = 5.0  # Stabile = |actual| < 5%

for r in work:
    actual    = get_actual(r)
    d_label   = str(r.get("dir_v4") or r.get("direction") or "")
    days      = fn(r.get("pre_catalyst_days"))
    is_dir    = d_label.startswith(("↑","↓"))

    # Fascia days
    if days is None:     band = "days=N/A"
    elif days <= 7:      band = "T<=7gg"
    elif days <= 15:     band = "T<=15gg"
    elif days <= 30:     band = "T<=30gg"
    else:                band = "T>30gg"

    # ── Valutazione OLD ──────────────────────────────────────────────────────
    old_res = eval_dir(d_label, actual)
    if old_res is True:  OLD_hit  += 1
    elif old_res is False: OLD_miss += 1
    else: continue  # skip non-valutabili (label ambigua)

    if old_res is True:  by_days_old[band][0] += 1
    else:                by_days_old[band][1] += 1

    # ── Valutazione NEW ──────────────────────────────────────────────────────
    # Il nuovo modello cambia in Stabile le call direzionali a:
    #   T>30gg con |net| <= 4 (non abbiamo net stored, approssimiamo:
    #     la stragrande maggioranza delle call a T>30 aveva net 3-4)
    #   T>15gg con |net| <= 3
    # In pratica: tutti i dir a T>30 e dir "non forti" a T>15-30.
    # Per approssimare: le call ↑↑/↓↓ (Forte) avevano net>=4, le ↑/↓ (lieve) avevano net=3.
    # T>30: soppresse net<=4 = tutte le ↑ e ↓ (mild), ↑↑/↓↓ (strong) solo se net<5
    # Senza net score archiviato, usiamo: T>30 -> TUTTE diventano Stabile (conservativo)
    #                                     T>15 -> solo ↑ e ↓ lieve diventano Stabile

    new_label = d_label  # default: mantieni
    if is_dir and days is not None:
        if days > 30:
            # T>30: tutte le call direzionali erano con net<=4 (dati storici)
            new_label = "→ Stabile"
        elif days > 15:
            # T>15-30: solo le mild (non ↑↑/↓↓) vengono soppresse
            if not (d_label.startswith("↑↑") or d_label.startswith("↓↓")):
                new_label = "→ Stabile"

    new_res = eval_dir(new_label, actual)
    if new_res is True:  NEW_hit  += 1
    elif new_res is False: NEW_miss += 1

    if new_res is True:  by_days_new[band][0] += 1
    else:                by_days_new[band][1] += 1

    # ── Tracking cambio ─────────────────────────────────────────────────────
    if new_label != d_label:
        changed_count += 1
        if new_res is True and old_res is False:
            changed_better += 1
        elif new_res is False and old_res is True:
            changed_worse += 1
        else:
            changed_same += 1

# ── Report ────────────────────────────────────────────────────────────────────
OLD_tot = OLD_hit + OLD_miss
NEW_tot = NEW_hit + NEW_miss
OLD_pct = round(OLD_hit/OLD_tot*100, 1) if OLD_tot else None
NEW_pct = round(NEW_hit/NEW_tot*100, 1) if NEW_tot else None

print("=" * 60)
print("  RISULTATO GLOBALE")
print("=" * 60)
print(f"  Vecchio modello:  {OLD_pct}%  (hit={OLD_hit}/{OLD_tot})")
print(f"  Nuovo  modello:   {NEW_pct}%  (hit={NEW_hit}/{NEW_tot})")
if OLD_pct and NEW_pct:
    delta = round(NEW_pct - OLD_pct, 1)
    print(f"  Miglioramento:    {delta:+.1f}pp")

print()
print("=" * 60)
print("  DETTAGLIO PREDIZIONI CAMBIATE")
print("=" * 60)
print(f"  Totale predizioni cambiate (dir -> Stabile): {changed_count}")
print(f"    Meglio (vecchio sbagliato, nuovo giusto):  {changed_better}")
print(f"    Peggio (vecchio giusto, nuovo sbagliato):  {changed_worse}")
print(f"    Invariato (entrambi ok o entrambi no):     {changed_same}")

print()
print("=" * 60)
print("  HIT% PER FASCIA TEMPORALE (confronto old vs new)")
print("=" * 60)
print(f"  {'Fascia':<12}  {'Old N':>5}  {'Old%':>6}  {'New N':>5}  {'New%':>6}  Delta")

for band in ["T<=7gg","T<=15gg","T<=30gg","T>30gg","days=N/A"]:
    oh, om = by_days_old[band]
    nh, nm = by_days_new[band]
    o_tot = oh+om; n_tot = nh+nm
    op = round(oh/o_tot*100,1) if o_tot else None
    np_ = round(nh/n_tot*100,1) if n_tot else None
    d = round((np_ or 0)-(op or 0), 1) if (op and np_) else None
    ds = f"{d:+.1f}pp" if d is not None else "N/A"
    print(f"  {band:<12}  {o_tot:>5}  {str(op)+'%':>6}  {n_tot:>5}  {str(np_)+'%':>6}  {ds}")

print()
print("=" * 60)
print("  ANALISI: quali call diventano Stabile e sono corrette?")
print("=" * 60)
# Distribuzione degli actual per le call che cambiano
actual_vals_changed = []
for r in work:
    actual = get_actual(r)
    d_label = str(r.get("dir_v4") or r.get("direction") or "")
    days = fn(r.get("pre_catalyst_days"))
    is_dir = d_label.startswith(("↑","↓"))
    if not is_dir: continue
    if days is None: continue
    will_change = (days > 30) or (days > 15 and not d_label.startswith(("↑↑","↓↓")))
    if will_change and actual is not None:
        actual_vals_changed.append(actual)

if actual_vals_changed:
    n = len(actual_vals_changed)
    pct_within5 = sum(1 for x in actual_vals_changed if abs(x) < 5.0)/n*100
    pct_pos = sum(1 for x in actual_vals_changed if x > 0)/n*100
    median = sorted(actual_vals_changed)[n//2]
    mean_ = sum(actual_vals_changed)/n
    print(f"  Call che diventano Stabile: {n}")
    print(f"  Di queste, |actual|<5% (cioe' corrette come Stabile): {pct_within5:.1f}%")
    print(f"  Di queste, actual>0 (direzione era UP):               {pct_pos:.1f}%")
    print(f"  Mediana actual: {median:+.1f}pp   Media: {mean_:+.1f}pp")
    print()
    print(f"  => Come Stabile sarebbero corrette nel {pct_within5:.1f}% dei casi")
    print(f"     Come direzionali (vecchio) erano corrette nel 49.4% dei casi")
    delta2 = round(pct_within5 - 49.4, 1)
    print(f"     Differenza: {delta2:+.1f}pp per queste call specifiche")
