"""
Quantifica l'incertezza della curva pre-catalyst per distanza dal CD.

Metodologia:
- Per ogni record con traiettoria storica completa, simula una previsione
  lineare basata su slope_5d/slope_20d al momento T-d
- Confronta la previsione con il reale ai punti successivi
- Calcola il residuo = reale - previsto
- L'SD dei residui = quantificazione dell'incertezza per distanza + orizzonte

Risponde a: "quanto può discostarsi la curva dal reale a seconda della distanza dal CD?"
"""
import json, sys, io, os, math
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data/past_catalyst_predictions.json"), encoding="utf-8") as f:
    doc = json.load(f)
raw = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

def fn(v):
    try: return float(v) if v is not None else None
    except: return None

def pct_change(p0, p1):
    """Variazione % da p0 a p1."""
    if p0 is None or p1 is None or p0 == 0: return None
    return (p1 - p0) / abs(p0) * 100

def percentile(vals, p):
    n = len(vals)
    if n == 0: return None
    i = int(n * p)
    return sorted(vals)[min(i, n-1)]

# Solo record con traiettoria completa e dati slope
valid = []
for r in rows:
    m60 = fn(r.get("close_m60"))
    m30 = fn(r.get("close_m30"))
    m10 = fn(r.get("close_m10"))
    m7  = fn(r.get("close_m7"))
    m5  = fn(r.get("close_m5"))
    m3  = fn(r.get("close_m3"))
    cd  = fn(r.get("price_at_cd"))
    s5  = fn(r.get("slope_5d"))
    s20 = fn(r.get("slope_20d"))
    if None in (m30, m10, m7, m5, m3, cd, s5, s20): continue
    if m30 == 0: continue
    valid.append({"m60":m60,"m30":m30,"m10":m10,"m7":m7,"m5":m5,"m3":m3,"cd":cd,
                  "s5":s5,"s20":s20,
                  "days": fn(r.get("pre_catalyst_days"))})

print(f"Record con traiettoria + slope completi: {len(valid)}")
print()

# ─── 1. BASELINE: deviazione INCONDIZIONATA della curva reale dal punto fisso ──
# "Se non sai nulla, di quanto si discosta il prezzo da T-d?"
print("=" * 70)
print("1. DEVIAZIONE INCONDIZIONATA (baseline, nessun modello)")
print("   -> quanto si muove il prezzo in media da T-30 al punto futuro?")
print("=" * 70)
print(f"  {'Da → A':<18}  {'N':>5}  {'media':>8}  {'SD':>8}  {'P25':>8}  {'P75':>8}  {'IQR90':>8}")

# Da T-30 baseline
for target_key, target_field, label in [
    ("T-10", "m10", "T-30 -> T-10"),
    ("T-7",  "m7",  "T-30 -> T-7"),
    ("T-5",  "m5",  "T-30 -> T-5"),
    ("T-3",  "m3",  "T-30 -> T-3"),
]:
    moves = [pct_change(r["m30"], r[target_field]) for r in valid if r[target_field] is not None]
    moves = [x for x in moves if x is not None and abs(x) < 200]  # rimuovi outlier estremi
    if not moves: continue
    n = len(moves)
    avg = sum(moves)/n
    sd = math.sqrt(sum((x-avg)**2 for x in moves)/n)
    p25 = percentile(moves, 0.25)
    p75 = percentile(moves, 0.75)
    p5  = percentile(moves, 0.05)
    p95 = percentile(moves, 0.95)
    iqr90 = f"[{p5:+.1f},{p95:+.1f}]"
    print(f"  {label:<18}  {n:>5}  {avg:>+7.2f}%  {sd:>7.2f}pp  {p25:>+7.1f}%  {p75:>+7.1f}%  {iqr90:>10}")

# ─── 2. ERRORE MODELLO LINEARE: previsto con slope vs reale ──────────────────
print()
print("=" * 70)
print("2. ERRORE MODELLO LINEARE (slope_20d x giorni) vs reale")
print("   -> residuo = reale - previsto; SD residui = incertezza del modello")
print("=" * 70)
print(f"  {'Orizzonte':<18}  {'N':>5}  {'bias':>8}  {'SD errore':>10}  {'P10/P90':>18}  Note")

# Proiezione lineare da T-30: previsto_T-d = run_up_start + slope_20d * giorni
# run_up_start ~ 0 perché normalizziamo a m30
for delta_days, target_field, label in [
    (20, "m10", "T-30 -> T-10 (20gg)"),
    (23, "m7",  "T-30 -> T-7  (23gg)"),
    (25, "m5",  "T-30 -> T-5  (25gg)"),
    (27, "m3",  "T-30 -> T-3  (27gg)"),
]:
    residuals = []
    for r in valid:
        target_val = r[target_field]
        if target_val is None: continue
        actual_pct = pct_change(r["m30"], target_val)
        if actual_pct is None: continue
        # Previsione lineare: slope_20d (pp/giorno) * delta_giorni
        predicted_pct = r["s20"] * delta_days
        residual = actual_pct - predicted_pct
        if abs(residual) < 200:  # rimuovi outlier
            residuals.append(residual)
    if not residuals: continue
    n = len(residuals)
    bias = sum(residuals)/n
    sd = math.sqrt(sum((x-bias)**2 for x in residuals)/n)  # SD centrata
    sd_raw = math.sqrt(sum(x**2 for x in residuals)/n)  # RMSE
    p10 = percentile(residuals, 0.10)
    p90 = percentile(residuals, 0.90)
    note = "RMSE=" + f"{sd_raw:.1f}pp"
    print(f"  {label:<18}  {n:>5}  {bias:>+7.2f}pp  {sd:>9.2f}pp  [{p10:+.1f},{p90:+.1f}]pp  {note}")

# ─── 3. INCERTEZZA PER DISTANZA DAL CD al momento della predizione ───────────
print()
print("=" * 70)
print("3. INCERTEZZA x DISTANZA DAL CD (quando fai la prediction)")
print("   -> se sei a T-X dal CD, quanto e' imprecisa la proiezione a T-7?")
print("=" * 70)
print(f"  {'Sei a...':<12}  {'Prevedi T-7':<14}  {'N':>5}  {'SD errore':>10}  {'RMSE':>8}  {'IQR80':>14}")

# Per distanza dal CD (usando pre_catalyst_days)
for d_lo, d_hi, label in [
    (8, 15,  "T-8..15"),
    (16, 25, "T-16..25"),
    (26, 35, "T-26..35"),
    (36, 50, "T-36..50"),
    (51, 90, "T-51..90"),
]:
    subset = [r for r in valid if r["days"] is not None and d_lo <= r["days"] <= d_hi]
    if len(subset) < 20: continue
    residuals = []
    for r in subset:
        m7 = r["m7"]
        if m7 is None: continue
        actual_pct = pct_change(r["m30"], m7)
        if actual_pct is None: continue
        # Proiezione da posizione corrente verso T-7
        # Giorni rimanenti da posizione corrente a T-7
        d_now = r["days"]
        d_remaining = d_now - 7
        predicted_pct = r["s20"] * d_remaining if d_remaining > 0 else 0
        residual = actual_pct - predicted_pct
        if abs(residual) < 200:
            residuals.append(residual)
    if len(residuals) < 20: continue
    n = len(residuals)
    bias = sum(residuals)/n
    sd = math.sqrt(sum((x-bias)**2 for x in residuals)/n)
    rmse = math.sqrt(sum(x**2 for x in residuals)/n)
    p10 = percentile(residuals, 0.10)
    p90 = percentile(residuals, 0.90)
    iqr80 = f"[{p10:+.0f},{p90:+.0f}]pp"
    print(f"  {label:<12}  {'-> T-7':<14}  {n:>5}  {sd:>9.1f}pp  {rmse:>7.1f}pp  {iqr80:>14}")

# ─── 4. PATTERN TRAIETTORIA: categorie di run_up con traiettorie simili ──────
print()
print("=" * 70)
print("4. PATTERN TRAIETTORIA per tipo di run_up corrente")
print("   -> se il run_up e' X, qual e' la traiettoria tipica fino a T-7?")
print("=" * 70)
print(f"  {'run_up_30d':>14}  {'N':>5}  {'T-10 medio':>11}  {'T-7 medio':>11}  {'T-3 medio':>11}  {'SD T-7':>8}")

buckets = defaultdict(list)
for r in valid:
    ru = pct_change(r["m60"] or r["m30"], r["m30"]) if r.get("m60") else None
    if ru is None:
        # Usa slope_20d come proxy
        ru = r["s20"] * 30
    if ru >= 25:     k = "run_up>=25%"
    elif ru >= 10:   k = "run_up 10-25%"
    elif ru >= 0:    k = "run_up 0-10%"
    elif ru >= -10:  k = "run_up -10-0%"
    else:            k = "run_up<-10%"
    buckets[k].append(r)

for k in ["run_up>=25%","run_up 10-25%","run_up 0-10%","run_up -10-0%","run_up<-10%"]:
    subset = buckets[k]
    if len(subset) < 20: continue
    t10 = [pct_change(r["m30"],r["m10"]) for r in subset if pct_change(r["m30"],r["m10"]) is not None]
    t7  = [pct_change(r["m30"],r["m7"])  for r in subset if pct_change(r["m30"],r["m7"])  is not None]
    t3  = [pct_change(r["m30"],r["m3"])  for r in subset if pct_change(r["m30"],r["m3"])  is not None]
    t10 = [x for x in t10 if abs(x)<100]; t7=[x for x in t7 if abs(x)<100]; t3=[x for x in t3 if abs(x)<100]
    if not t7: continue
    avg10 = sum(t10)/len(t10) if t10 else None
    avg7  = sum(t7)/len(t7)
    avg3  = sum(t3)/len(t3) if t3 else None
    sd7   = math.sqrt(sum((x-avg7)**2 for x in t7)/len(t7))
    print(f"  {k:>14}  {len(subset):>5}  {avg10:>+10.1f}%  {avg7:>+10.1f}%  {avg3:>+10.1f}%  {sd7:>7.1f}pp")
