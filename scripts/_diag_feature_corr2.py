"""Correlazione feature -> esito reale con nomi campi corretti."""
import json, sys, io, os, math
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data/past_catalyst_predictions.json"), encoding="utf-8") as f:
    doc = json.load(f)
raw = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

def get_actual(r):
    for k in ("d3_pct","d5_pct"):
        v = r.get(k)
        if v is not None:
            try: return float(v)
            except: pass
    return None

def fn(v):
    try: return float(v) if v is not None else None
    except: return None

work = [r for r in rows if get_actual(r) is not None and int(r.get("affidabilita",0) or 0) > 0]
outcome_binary = [1 if (get_actual(r) or 0) > 0 else 0 for r in work]

def point_biserial(fvals, outcomes):
    paired = [(f, o) for f, o in zip(fvals, outcomes) if f is not None and math.isfinite(f)]
    if len(paired) < 30: return None, len(paired)
    fs = [p[0] for p in paired]
    os_l = [p[1] for p in paired]
    n = len(paired)
    mean_all = sum(fs)/n
    sd = math.sqrt(sum((f - mean_all)**2 for f in fs) / n) if n > 1 else 0
    n1 = sum(os_l); n0 = n - n1
    m1 = sum(f for f,o in paired if o==1)/max(1,n1)
    m0 = sum(f for f,o in paired if o==0)/max(1,n0)
    if sd == 0: return 0.0, n
    rpb = (m1-m0)/sd * math.sqrt(n1*n0/n**2)
    return round(rpb, 4), n

# Feature corrette
features = {
    "run_up_30d":        [fn(r.get("run_up_30d")) for r in work],
    "run_up_7d":         [fn(r.get("run_up_7d")) for r in work],
    "rsi_14":            [fn(r.get("rsi_14")) for r in work],
    "exc_slope_XBI":     [fn(r.get("exc_slope_vs_XBI")) for r in work],
    "slope_5d":          [fn(r.get("slope_5d")) for r in work],
    "slope_20d":         [fn(r.get("slope_20d")) for r in work],
    "slope_45d":         [fn(r.get("slope_45d")) for r in work],
    "vol_ratio":         [fn(r.get("vol_ratio")) for r in work],
    "vol_accel":         [fn(r.get("vol_accel")) for r in work],
    "vol_price_div":     [fn(r.get("vol_price_div")) for r in work],
    "ath_prox_52wk":     [fn(r.get("ath_prox_52wk")) for r in work],
    "affidabilita":      [fn(r.get("affidabilita")) for r in work],
    "score_v4":          [fn(r.get("score_v4")) for r in work],
    "score_v4_t5":       [fn(r.get("score_v4_t5")) for r in work],
    "score_v4_t3":       [fn(r.get("score_v4_t3")) for r in work],
    "score_v4_post5":    [fn(r.get("score_v4_post5")) for r in work],
    "model_d5_pct":      [fn(r.get("model_d5_pct")) for r in work],
    "model_d3_pct":      [fn(r.get("model_d3_pct")) for r in work],
    "model_inputs_n":    [fn(r.get("model_inputs_present_n")) for r in work],
    "pre_catalyst_days": [fn(r.get("pre_catalyst_days")) for r in work],
    "struct_blend":      [fn(r.get("struct_blend")) for r in work],
    "delta_d5":          [fn(r.get("delta_d5")) for r in work],
}

print(f"Pool analizzato: {len(work)} record con actual e aff>0")
print()
print(f"{'Feature':<22} {'|phi|':>6}  {'phi':>7}  {'N':>5}  Interpretazione")
print("-"*75)

results = []
for fname, fvals in features.items():
    rpb, n = point_biserial(fvals, outcome_binary)
    if rpb is not None:
        results.append((abs(rpb), fname, rpb, n))
    else:
        results.append((0, fname, None, n))

results.sort(reverse=True)
for absphi, fname, phi, n in results:
    if phi is None:
        print(f"  {fname:<22} {'N/A':>6}  {'N/A':>7}  {n:>5}  dati insufficienti")
        continue
    if absphi < 0.03:   interp = "rumore puro"
    elif absphi < 0.07: interp = "segnale debolissimo"
    elif absphi < 0.12: interp = "segnale debole"
    elif absphi < 0.20: interp = "segnale moderato"
    else:               interp = "SEGNALE FORTE"
    sign = "(pos=piu UP)" if phi > 0 else "(neg=piu DOWN)"
    print(f"  {fname:<22} {absphi:>6.4f}  {phi:>+7.4f}  {n:>5}  {interp} {sign}")

# Analisi specifica: run_up vs esito reale (migliorata)
print()
print("=== BTR DETAIL: run_up_30d vs esito effettivo ===")
buckets = defaultdict(list)
for r in work:
    ru = fn(r.get("run_up_30d"))
    actual = get_actual(r)
    if ru is None or actual is None: continue
    if ru > 30:       k = ">30% (BTR forte)"
    elif ru > 15:     k = "15-30%"
    elif ru > 8:      k = "8-15%"
    elif ru > 0:      k = "0-8%"
    elif ru > -8:     k = "-8-0%"
    elif ru > -15:    k = "-15--8%"
    else:             k = "<-15% (CTR forte)"
    buckets[k].append(actual)

for k in [">30% (BTR forte)","15-30%","8-15%","0-8%","-8-0%","-15--8%","<-15% (CTR forte)"]:
    if buckets[k]:
        n = len(buckets[k])
        pup = sum(1 for x in buckets[k] if x > 0)/n*100
        med = sorted(buckets[k])[n//2]
        mean_ = sum(buckets[k])/n
        print(f"  {k:<25} N={n:>5}  %UP={pup:.1f}%  mediana={med:+.1f}pp  media={mean_:+.1f}pp")

# Analisi RSI
print()
print("=== RSI_14 vs esito effettivo ===")
buckets_rsi = defaultdict(list)
for r in work:
    rsi = fn(r.get("rsi_14"))
    actual = get_actual(r)
    if rsi is None or actual is None: continue
    if rsi > 72:   k = ">72 OB"
    elif rsi > 65: k = "65-72"
    elif rsi > 50: k = "50-65"
    elif rsi > 35: k = "35-50"
    elif rsi > 28: k = "28-35"
    else:          k = "<28 OS"
    buckets_rsi[k].append(actual)

for k in [">72 OB","65-72","50-65","35-50","28-35","<28 OS"]:
    if buckets_rsi[k]:
        n = len(buckets_rsi[k])
        pup = sum(1 for x in buckets_rsi[k] if x > 0)/n*100
        med = sorted(buckets_rsi[k])[n//2]
        print(f"  {k:<12} N={n:>5}  %UP={pup:.1f}%  mediana={med:+.1f}pp")

# Score_v4 numerici
print()
print("=== SCORE_V4 (numerico predizione) vs segno reale ===")
buckets_sc = defaultdict(list)
for r in work:
    sc = fn(r.get("score_v4"))
    actual = get_actual(r)
    if sc is None or actual is None: continue
    if sc > 10:     k = ">10pp"
    elif sc > 5:    k = "5-10pp"
    elif sc > 0:    k = "0-5pp"
    elif sc > -5:   k = "-5-0pp"
    elif sc > -10:  k = "-10--5pp"
    else:           k = "<-10pp"
    buckets_sc[k].append(actual)

for k in [">10pp","5-10pp","0-5pp","-5-0pp","-10--5pp","<-10pp"]:
    if buckets_sc[k]:
        n = len(buckets_sc[k])
        pup = sum(1 for x in buckets_sc[k] if x > 0)/n*100
        med = sorted(buckets_sc[k])[n//2]
        print(f"  {k:<12} N={n:>5}  %UP={pup:.1f}%  mediana={med:+.1f}pp")
