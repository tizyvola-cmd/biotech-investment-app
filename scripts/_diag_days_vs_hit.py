"""
Analizza Hit% delle predizioni direzionali segmentate per pre_catalyst_days.
Risponde a: il filtro T>15gg migliora davvero l'accuratezza?
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

def eval_dir(d: str, actual: float):
    if not d: return None
    if d.startswith("↑"): return actual > 0      # UP
    if d.startswith("↓"): return actual < 0      # DOWN
    if d.startswith("→") or "Stab" in d: return abs(actual) < 5.0  # Stabile
    return None

work = [r for r in rows if get_actual(r) is not None and int(r.get("affidabilita",0) or 0) > 0]
print(f"Pool totale: {len(work)} record con actual e aff>0")
print()

# Segmenta per pre_catalyst_days
def fn(v):
    try: return float(v) if v is not None else None
    except: return None

buckets = defaultdict(list)
for r in work:
    d = fn(r.get("pre_catalyst_days"))
    dir_v4 = str(r.get("dir_v4") or r.get("direction") or "")
    actual = get_actual(r)
    is_dir = dir_v4.startswith(("↑","↓"))  # arrow UP or DOWN
    if not is_dir:
        continue
    if d is None:
        buckets["days=N/A"].append(r)
    elif d <= 3:
        buckets["T<=3gg"].append(r)
    elif d <= 7:
        buckets["T<=7gg"].append(r)
    elif d <= 15:
        buckets["T<=15gg"].append(r)
    elif d <= 30:
        buckets["T<=30gg"].append(r)
    else:
        buckets["T>30gg"].append(r)

print("=== HIT% PREDIZIONI DIREZIONALI PER DISTANZA DALL'EVENTO ===")
print(f"  {'Fascia':<12}  {'N':>5}  {'Hit%':>6}  Note")
print("  " + "-"*55)

for k in ["T<=3gg","T<=7gg","T<=15gg","T<=30gg","T>30gg","days=N/A"]:
    subset = buckets[k]
    if not subset: continue
    hits = wrongs = 0
    for r in subset:
        actual = get_actual(r)
        d_label = str(r.get("dir_v4") or r.get("direction") or "")
        res = eval_dir(d_label, actual) if actual is not None else None
        if res is True: hits += 1
        elif res is False: wrongs += 1
    tot = hits + wrongs
    pct = round(hits/tot*100, 1) if tot else None
    note = ""
    if pct is not None:
        if pct >= 65: note = "<-- UTILE"
        elif pct >= 55: note = "<-- debole"
        elif pct >= 45: note = "<-- quasi caso"
        else: note = "<-- PEGGIO DEL CASO"
    print(f"  {k:<12}  {tot:>5}  {str(pct)+'%':>6}  {note}")

print()
print("=== SIMULAZIONE: cosa cambia con il nuovo filtro T>15gg? ===")
# Predizioni direzionali che verrebbero "soppresse" con la nuova soglia
total_dir = sum(len(v) for v in buckets.values())
suppressed = len(buckets["T<=30gg"]) + len(buckets["T>30gg"])
kept = len(buckets["T<=3gg"]) + len(buckets["T<=7gg"]) + len(buckets["T<=15gg"])
na = len(buckets.get("days=N/A", []))

print(f"  Predizioni direzionali totali (storiche): {total_dir}")
print(f"  Mantenute (T<=15gg):  {kept}  ({kept/total_dir*100:.1f}%)")
print(f"  Soppresse (T>15gg):   {suppressed}  ({suppressed/total_dir*100:.1f}%)")
if na: print(f"  Days=N/A (ignorate):  {na}")

# Calcola hit% sulle sole predizioni che verrebbero MANTENUTE
kept_records = buckets["T<=3gg"] + buckets["T<=7gg"] + buckets["T<=15gg"]
hits_k = wrongs_k = 0
for r in kept_records:
    actual = get_actual(r)
    d_label = str(r.get("dir_v4") or r.get("direction") or "")
    res = eval_dir(d_label, actual) if actual is not None else None
    if res is True: hits_k += 1
    elif res is False: wrongs_k += 1
tot_k = hits_k + wrongs_k
pct_k = round(hits_k/tot_k*100, 1) if tot_k else None

# Calcola hit% sulle predizioni che verrebbero SOPPRESSE
supp_records = buckets["T<=30gg"] + buckets["T>30gg"]
hits_s = wrongs_s = 0
for r in supp_records:
    actual = get_actual(r)
    d_label = str(r.get("dir_v4") or r.get("direction") or "")
    res = eval_dir(d_label, actual) if actual is not None else None
    if res is True: hits_s += 1
    elif res is False: wrongs_s += 1
tot_s = hits_s + wrongs_s
pct_s = round(hits_s/tot_s*100, 1) if tot_s else None

print()
print(f"  Hit% predizioni MANTENUTE (T<=15gg):  {pct_k}% (N={tot_k})")
print(f"  Hit% predizioni SOPPRESSE (T>15gg):   {pct_s}% (N={tot_s}) <- eliminare queste")
print()
if pct_k and pct_s:
    delta = round(pct_k - pct_s, 1)
    print(f"  Miglioramento atteso hit% direzionale: +{delta}pp (da {pct_s}% a {pct_k}%)")
    print(f"  Costo: -({suppressed/total_dir*100:.0f}%) delle call direzionali -> piu' Stabile")
