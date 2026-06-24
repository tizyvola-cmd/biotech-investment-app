"""
Analizza il valore predittivo PONDERATO delle predizioni finali.
Ipotesi: il run_up/slope codifica informazioni reali (K-8, conferenze) ->
la pendenza della relazione score_v4/run_up vs actual_outcome dovrebbe
mostrare segnale reale, specialmente vicino all'evento.
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

work = [r for r in rows if get_actual(r) is not None and int(r.get("affidabilita",0) or 0) > 0]

def pearson(xs, ys):
    n = len(xs)
    if n < 10: return None, n
    mx = sum(xs)/n; my = sum(ys)/n
    num = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    dx  = math.sqrt(sum((x-mx)**2 for x in xs))
    dy  = math.sqrt(sum((y-my)**2 for y in ys))
    if dx == 0 or dy == 0: return 0.0, n
    return round(num/(dx*dy), 4), n

def slope_intercept(xs, ys):
    """OLS: actual = slope * x + intercept"""
    n = len(xs)
    if n < 10: return None, None
    mx = sum(xs)/n; my = sum(ys)/n
    num = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    den = sum((x-mx)**2 for x in xs)
    if den == 0: return 0.0, my
    slope = num/den
    return round(slope, 4), round(my - slope*mx, 4)

# ─────────────────────────────────────────────────────────────────
# 1. CORRELAZIONE CONTINUA: score_v4 → actual (non binaria)
# ─────────────────────────────────────────────────────────────────
print("=" * 65)
print("1. CORRELAZIONE CONTINUA score_v4 -> actual_pct")
print("   (Pearson, non binaria: misura la pendenza reale)")
print("=" * 65)

features_cont = {
    "score_v4":       [fn(r.get("score_v4"))       for r in work],
    "model_d5_pct":   [fn(r.get("model_d5_pct"))   for r in work],
    "model_d3_pct":   [fn(r.get("model_d3_pct"))   for r in work],
    "run_up_30d":     [fn(r.get("run_up_30d"))      for r in work],
    "run_up_7d":      [fn(r.get("run_up_7d"))       for r in work],
    "slope_5d":       [fn(r.get("slope_5d"))        for r in work],
    "slope_20d":      [fn(r.get("slope_20d"))       for r in work],
    "affidabilita":   [fn(r.get("affidabilita"))    for r in work],
    "struct_blend":   [fn(r.get("struct_blend"))    for r in work],
    "delta_d5":       [fn(r.get("delta_d5"))        for r in work],
}
actuals = [get_actual(r) for r in work]

print(f"  {'Feature':<18} {'r':>7}  {'N':>5}  {'slope':>8}  Interpretazione")
print("  " + "-"*60)
for fname, fvals in features_cont.items():
    pairs = [(f, a) for f, a in zip(fvals, actuals) if f is not None and a is not None]
    if len(pairs) < 30:
        print(f"  {fname:<18} {'N/A':>7}  {len(pairs):>5}  {'N/A':>8}  dati insufficienti")
        continue
    xs = [p[0] for p in pairs]; ys = [p[1] for p in pairs]
    r, n = pearson(xs, ys)
    sl, ic = slope_intercept(xs, ys)
    interp = ""
    if abs(r) < 0.03:  interp = "rumore"
    elif abs(r) < 0.07: interp = "segnale debolissimo"
    elif abs(r) < 0.12: interp = "segnale debole"
    elif abs(r) < 0.20: interp = "segnale moderato"
    else:               interp = "SEGNALE FORTE"
    sign = "(previsioni alte -> outcome alto)" if r > 0 else "(previsioni alte -> outcome basso)"
    slope_str = f"{sl:+.3f}" if sl is not None else "N/A"
    print(f"  {fname:<18} {r:>+7.4f}  {n:>5}  {slope_str:>8}  {interp} {sign}")

# ─────────────────────────────────────────────────────────────────
# 2. PENDENZA per fascia temporale (run_up info flow)
# ─────────────────────────────────────────────────────────────────
print()
print("=" * 65)
print("2. RUN_UP -> ACTUAL: pendenza per distanza evento")
print("   (testa l'ipotesi: info nel run_up vale di piu' vicino al catalyst)")
print("=" * 65)
print(f"  {'Fascia':<12}  {'N':>4}  {'r(runup,act)':>13}  {'slope':>8}  {'%UP':>5}")

for band_label, lo, hi in [("T<=7gg",0,7),("T<=15gg",8,15),("T<=30gg",16,30),("T>30gg",31,9999)]:
    subset = [r for r in work
              if fn(r.get("pre_catalyst_days")) is not None
              and lo <= fn(r.get("pre_catalyst_days")) <= hi]
    if not subset:
        continue
    xs = [fn(r.get("run_up_30d")) for r in subset]
    ys = [get_actual(r) for r in subset]
    pairs = [(x,y) for x,y in zip(xs,ys) if x is not None and y is not None]
    if len(pairs) < 10:
        print(f"  {band_label:<12}  {len(pairs):>4}  {'N/A':>13}  {'N/A':>8}  N/A")
        continue
    pxs = [p[0] for p in pairs]; pys = [p[1] for p in pairs]
    r, n = pearson(pxs, pys)
    sl, _ = slope_intercept(pxs, pys)
    pup = sum(1 for y in pys if y > 0)/len(pys)*100
    sl_str = f"{sl:+.3f}" if sl is not None else "N/A"
    r_str = f"{r:+.4f}" if r is not None else "N/A"
    print(f"  {band_label:<12}  {n:>4}  {r_str:>13}  {sl_str:>8}  {pup:>4.1f}%")

# ─────────────────────────────────────────────────────────────────
# 3. SCORE_V4 buckets: pendenza predizione -> esito reale
# ─────────────────────────────────────────────────────────────────
print()
print("=" * 65)
print("3. SCORE_V4 buckets: la pendenza predizione-esito e' monotona?")
print("   (se il modello ha valore, predizioni piu' alte = esiti piu' alti)")
print("=" * 65)
print(f"  {'Bucket':>12}  {'N':>5}  {'media actual':>13}  {'%UP':>5}  {'mediana':>8}")

sc_buckets = defaultdict(list)
for r in work:
    sc = fn(r.get("score_v4"))
    actual = get_actual(r)
    if sc is None or actual is None: continue
    if sc >= 15:    k = ">=15pp"
    elif sc >= 10:  k = "10-15pp"
    elif sc >= 5:   k = "5-10pp"
    elif sc >= 2:   k = "2-5pp"
    elif sc >= -2:  k = "-2/+2pp"
    elif sc >= -5:  k = "-5--2pp"
    elif sc >= -10: k = "-10--5pp"
    else:           k = "<-10pp"
    sc_buckets[k].append(actual)

for k in [">=15pp","10-15pp","5-10pp","2-5pp","-2/+2pp","-5--2pp","-10--5pp","<-10pp"]:
    vals = sc_buckets[k]
    if not vals: continue
    n = len(vals)
    avg = sum(vals)/n
    pup = sum(1 for x in vals if x > 0)/n*100
    med = sorted(vals)[n//2]
    print(f"  {k:>12}  {n:>5}  {avg:>+12.2f}pp  {pup:>4.1f}%  {med:>+7.1f}pp")

# ─────────────────────────────────────────────────────────────────
# 4. RUN_UP buckets: pendenza informazione -> esito
# ─────────────────────────────────────────────────────────────────
print()
print("=" * 65)
print("4. RUN_UP buckets: informazioni di mercato -> esito reale")
print("   (testa se il run_up codifica informazioni sui dati pubblicati)")
print("=" * 65)
print(f"  {'run_up':>14}  {'N':>5}  {'media actual':>13}  {'%UP':>5}  {'mediana':>8}")

ru_buckets = defaultdict(list)
for r in work:
    ru = fn(r.get("run_up_30d"))
    actual = get_actual(r)
    if ru is None or actual is None: continue
    if ru >= 40:    k = ">=40%"
    elif ru >= 25:  k = "25-40%"
    elif ru >= 15:  k = "15-25%"
    elif ru >= 8:   k = "8-15%"
    elif ru >= 0:   k = "0-8%"
    elif ru >= -8:  k = "-8-0%"
    elif ru >= -15: k = "-15--8%"
    elif ru >= -25: k = "-25--15%"
    else:           k = "<-25%"
    ru_buckets[k].append(actual)

for k in [">=40%","25-40%","15-25%","8-15%","0-8%","-8-0%","-15--8%","-25--15%","<-25%"]:
    vals = ru_buckets[k]
    if not vals: continue
    n = len(vals)
    avg = sum(vals)/n
    pup = sum(1 for x in vals if x > 0)/n*100
    med = sorted(vals)[n//2]
    trend = "<-- BTR: mercato ha gia' scontato notizie buone" if k in [">=40%","25-40%"] else \
            ("<-- CTR: mercato scettico, rimbalzo possibile" if k in ["<-25%","-25--15%"] else "")
    print(f"  {k:>14}  {n:>5}  {avg:>+12.2f}pp  {pup:>4.1f}%  {med:>+7.1f}pp  {trend}")

# ─────────────────────────────────────────────────────────────────
# 5. AFFIDABILITA' come peso: le previsioni ad alta aff hanno piu' segnale?
# ─────────────────────────────────────────────────────────────────
print()
print("=" * 65)
print("5. PESO affidabilita': piu' alta l'aff, piu' il score_v4 predice?")
print("   (misura se la ricalibrazione migliora il segnale ponderato)")
print("=" * 65)
print(f"  {'Aff band':>10}  {'N':>5}  {'r(score_v4,actual)':>20}  {'slope':>8}")

for band_label, lo, hi in [("30-49",30,49),("50-64",50,64),("65-79",65,79),("80-95",80,95)]:
    subset = [r for r in work if lo <= int(r.get("affidabilita",0) or 0) <= hi]
    xs = [fn(r.get("score_v4")) for r in subset]
    ys = [get_actual(r) for r in subset]
    pairs = [(x,y) for x,y in zip(xs,ys) if x is not None and y is not None]
    if len(pairs) < 10:
        print(f"  {band_label:>10}  {len(pairs):>5}  {'N/A':>20}  {'N/A':>8}")
        continue
    pxs=[p[0] for p in pairs]; pys=[p[1] for p in pairs]
    r, n = pearson(pxs, pys)
    sl, _ = slope_intercept(pxs, pys)
    sl_str = f"{sl:+.4f}" if sl is not None else "N/A"
    r_str = f"{r:+.4f}" if r is not None else "N/A"
    print(f"  {band_label:>10}  {n:>5}  {r_str:>20}  {sl_str:>8}")
