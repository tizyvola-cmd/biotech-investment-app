"""
Per ogni segnale che usa direction_ensemble, misura la correlazione
con l'esito reale (d3/d5 positivo/negativo) sui record storici.
Risponde a: quali segnali predicono davvero la direzione?
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
    for k in ("d3_pct", "d5_pct"):
        v = r.get(k)
        if v is not None:
            try: return float(v)
            except: pass
    return None

def fn(v):
    try: return float(v) if v is not None else None
    except: return None

# Solo record con actual E aff>0
work = [r for r in rows if get_actual(r) is not None and int(r.get("affidabilita",0) or 0) > 0]
print(f"Record analizzati: {len(work)}")
print()

# Per ogni segnale, split in presenza/assenza e misura hit rate della DIREZIONE REALE
# "Direzione reale": actual > 0 = UP, actual < 0 = DOWN
def pct_up(subset):
    if not subset: return None, 0
    ups = sum(1 for r in subset if (get_actual(r) or 0) > 0)
    return round(ups/len(subset)*100, 1), len(subset)

# ─── 1. SIGNAL: run_up (BTR effect) ──────────────────────────────────────────
print("=== RUN_UP 30gg (segnale Buy-The-Rumor) ===")
buckets_ru = defaultdict(list)
for r in work:
    ru = fn(r.get("run_up_30d") or r.get("run_up"))
    if ru is None: buckets_ru["N/A"].append(r); continue
    if ru > 30:    buckets_ru[">30%"].append(r)
    elif ru > 15:  buckets_ru["15-30%"].append(r)
    elif ru > 8:   buckets_ru["8-15%"].append(r)
    elif ru > 0:   buckets_ru["0-8%"].append(r)
    elif ru > -8:  buckets_ru["-8-0%"].append(r)
    elif ru > -15: buckets_ru["-15--8%"].append(r)
    else:          buckets_ru["<-15%"].append(r)

print(f"  {'Fascia':<12} {'N':>5}  %UP_reale  (teoria BTR: alto run_up → post-catalyst DOWN)")
for k in [">30%","15-30%","8-15%","0-8%","-8-0%","-15--8%","<-15%","N/A"]:
    pup, n = pct_up(buckets_ru[k])
    if n > 0:
        theory = " <- BTR: previsto DOWN" if k in [">30%","15-30%"] else (" <- CTR: previsto UP" if k in ["<-15%","-15--8%"] else "")
        print(f"  {k:<12} {n:>5}  {str(pup)+'%':>8}{theory}")

# ─── 2. SIGNAL: RSI ──────────────────────────────────────────────────────────
print()
print("=== RSI (Overbought/Oversold) ===")
buckets_rsi = defaultdict(list)
for r in work:
    rsi = fn(r.get("rsi"))
    if rsi is None: buckets_rsi["N/A"].append(r); continue
    if rsi > 72:   buckets_rsi[">72 OB"].append(r)
    elif rsi > 65: buckets_rsi["65-72"].append(r)
    elif rsi > 50: buckets_rsi["50-65"].append(r)
    elif rsi > 35: buckets_rsi["35-50"].append(r)
    elif rsi > 28: buckets_rsi["28-35"].append(r)
    else:          buckets_rsi["<28 OS"].append(r)

print(f"  {'Fascia':<12} {'N':>5}  %UP_reale  (teoria: OB→DOWN, OS→UP)")
for k in [">72 OB","65-72","50-65","35-50","28-35","<28 OS","N/A"]:
    pup, n = pct_up(buckets_rsi[k])
    if n > 0:
        print(f"  {k:<12} {n:>5}  {str(pup)+'%':>8}")

# ─── 3. SIGNAL: exc_slope / slope ────────────────────────────────────────────
print()
print("=== SLOPE (excess vs XBI, o raw slope) ===")
buckets_sl = defaultdict(list)
for r in work:
    sl = fn(r.get("exc_slope") or r.get("slope"))
    if sl is None: buckets_sl["N/A"].append(r); continue
    if sl >= 1.5:    buckets_sl[">=1.5"].append(r)
    elif sl >= 0.5:  buckets_sl["0.5-1.5"].append(r)
    elif sl >= -0.5: buckets_sl["-0.5-0.5"].append(r)
    elif sl >= -1.5: buckets_sl["-1.5--0.5"].append(r)
    else:            buckets_sl["<-1.5"].append(r)

print(f"  {'Fascia':<14} {'N':>5}  %UP_reale  (teoria: slope+ → UP)")
for k in [">=1.5","0.5-1.5","-0.5-0.5","-1.5--0.5","<-1.5","N/A"]:
    pup, n = pct_up(buckets_sl[k])
    if n > 0:
        print(f"  {k:<14} {n:>5}  {str(pup)+'%':>8}")

# ─── 4. SIGNAL: vol_ratio ────────────────────────────────────────────────────
print()
print("=== VOL_RATIO (volume anomalo) ===")
buckets_vr = defaultdict(list)
for r in work:
    vr = fn(r.get("vol_ratio"))
    if vr is None: buckets_vr["N/A"].append(r); continue
    if vr >= 2.0:   buckets_vr[">=2x"].append(r)
    elif vr >= 1.5: buckets_vr["1.5-2x"].append(r)
    elif vr >= 1.0: buckets_vr["1-1.5x"].append(r)
    elif vr >= 0.6: buckets_vr["0.6-1x"].append(r)
    else:           buckets_vr["<0.6x"].append(r)

print(f"  {'Fascia':<12} {'N':>5}  %UP_reale  (teoria: vol alto → UP momentum)")
for k in [">=2x","1.5-2x","1-1.5x","0.6-1x","<0.6x","N/A"]:
    pup, n = pct_up(buckets_vr[k])
    if n > 0:
        print(f"  {k:<12} {n:>5}  {str(pup)+'%':>8}")

# ─── 5. SIGNAL: PCR (put/call ratio) ─────────────────────────────────────────
print()
print("=== PCR (put/call ratio) ===")
buckets_pcr = defaultdict(list)
for r in work:
    pcr = fn(r.get("pcr"))
    if pcr is None: buckets_pcr["N/A"].append(r); continue
    if pcr > 2.5:   buckets_pcr[">2.5 panic"].append(r)
    elif pcr > 1.5: buckets_pcr["1.5-2.5 hedge"].append(r)
    elif pcr > 0.7: buckets_pcr["0.7-1.5 neutro"].append(r)
    elif pcr > 0.5: buckets_pcr["0.5-0.7 call-excess"].append(r)
    else:           buckets_pcr["<0.5 call-frenzy"].append(r)

print(f"  {'Fascia':<20} {'N':>5}  %UP_reale  (teoria: PCR alto(put)→contrarian UP; basso(call)→DOWN)")
for k in [">2.5 panic","1.5-2.5 hedge","0.7-1.5 neutro","0.5-0.7 call-excess","<0.5 call-frenzy","N/A"]:
    pup, n = pct_up(buckets_pcr[k])
    if n > 0:
        print(f"  {k:<20} {n:>5}  {str(pup)+'%':>8}")

# ─── 6. SIGNAL: phase ────────────────────────────────────────────────────────
print()
print("=== FASE CLINICA (1/2/3) ===")
buckets_ph = defaultdict(list)
for r in work:
    ph = str(r.get("phase") or r.get("studio_phase") or "").upper()
    if "3" in ph:   buckets_ph["Phase 3"].append(r)
    elif "2" in ph: buckets_ph["Phase 2"].append(r)
    elif "1" in ph: buckets_ph["Phase 1"].append(r)
    else:           buckets_ph["Other/N/A"].append(r)

print(f"  {'Fase':<12} {'N':>5}  %UP_reale  (info: Phase 3 = esito binario con mosse grandi)")
for k in ["Phase 3","Phase 2","Phase 1","Other/N/A"]:
    pup, n = pct_up(buckets_ph[k])
    if n > 0:
        print(f"  {k:<12} {n:>5}  {str(pup)+'%':>8}")

# ─── 7. SIGNAL: affidabilita vs direzione reale ───────────────────────────────
print()
print("=== AFFIDABILITA vs DIREZIONE REALE (solo predict direzionale) ===")
dir_preds = [r for r in work if str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]
# Quando il modello ha predetto UP, qual era il reale?
up_preds   = [r for r in dir_preds if str(r.get("dir_v4") or r.get("direction","")).startswith("↑")]
down_preds = [r for r in dir_preds if str(r.get("dir_v4") or r.get("direction","")).startswith("↓")]
pup_up, n_up   = pct_up(up_preds)
pup_dn, n_dn   = pct_up(down_preds)
print(f"  Quando modello dice ↑: realmente UP nel {pup_up}% dei casi (N={n_up})")
print(f"  Quando modello dice ↓: realmente UP nel {pup_dn}% dei casi (N={n_dn})")
print(f"    -> ↑ hits: {pup_up}%   ↓ hits: {100-pup_dn if pup_dn else 'N/A'}%")

# ─── 8. Correlazione punto-biseriale: quali feature hanno il Phi più alto? ───
print()
print("=== CORRELAZIONE feature → esito reale (UP=1/DOWN=0) ===")
print("  (Point-biserial: |phi| alto = segnale utile; 0 = rumore)")

def point_biserial(feature_vals, outcomes):
    """Correlazione tra feature continua e outcome binario."""
    paired = [(f, o) for f, o in zip(feature_vals, outcomes) if f is not None]
    if len(paired) < 30: return None, len(paired)
    fs = [p[0] for p in paired]
    os = [p[1] for p in paired]
    n = len(paired)
    m1 = sum(f for f, o in paired if o == 1) / max(1, sum(o for f, o in paired))
    m0 = sum(f for f, o in paired if o == 0) / max(1, sum(1-o for f, o in paired))
    sd = math.sqrt(sum((f - sum(fs)/n)**2 for f in fs) / n) if n > 1 else 0
    n1 = sum(o for f, o in paired)
    n0 = n - n1
    if sd == 0: return 0.0, n
    rpb = (m1 - m0) / sd * math.sqrt(n1 * n0 / n**2)
    return round(rpb, 3), n

outcome_binary = [1 if (get_actual(r) or 0) > 0 else 0 for r in work]

features = {
    "run_up_30d":    [fn(r.get("run_up_30d") or r.get("run_up")) for r in work],
    "rsi":           [fn(r.get("rsi")) for r in work],
    "exc_slope":     [fn(r.get("exc_slope") or r.get("slope")) for r in work],
    "vol_ratio":     [fn(r.get("vol_ratio")) for r in work],
    "vol_accel":     [fn(r.get("vol_accel")) for r in work],
    "slope_5d":      [fn(r.get("slope_5d")) for r in work],
    "slope_20d":     [fn(r.get("slope_20d")) for r in work],
    "ath_prox":      [fn(r.get("ath_prox")) for r in work],
    "days_to_t":     [fn(r.get("days_to_t")) for r in work],
    "affidabilita":  [fn(r.get("affidabilita")) for r in work],
    "pcr":           [fn(r.get("pcr")) for r in work],
    "exp_move_pct":  [fn(r.get("exp_move_pct")) for r in work],
    "model_inputs_n":[fn(r.get("model_inputs_present_n")) for r in work],
}

results = []
for fname, fvals in features.items():
    rpb, n = point_biserial(fvals, outcome_binary)
    if rpb is not None:
        results.append((abs(rpb), fname, rpb, n))

results.sort(reverse=True)
print(f"  {'Feature':<18} {'|phi|':>6}  {'phi':>7}  N      Interpretazione")
for absphi, fname, phi, n in results:
    interp = ""
    if absphi < 0.03:  interp = "rumore puro"
    elif absphi < 0.07: interp = "segnale debolissimo"
    elif absphi < 0.12: interp = "segnale debole"
    else:               interp = "SEGNALE UTILE"
    sign = "pos=UP" if phi > 0 else "neg=DOWN"
    print(f"  {fname:<18} {absphi:>6.3f}  {phi:>+7.3f}  {n:<5}  {interp} ({sign})")
