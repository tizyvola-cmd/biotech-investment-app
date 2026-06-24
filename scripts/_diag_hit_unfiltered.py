"""
Confronto Hit% su pool filtrato vs pool totale vs pool per fascia affidabilita/inputs.
Mostra anche la distribuzione reale e dove si forma il gap.
"""
import json, sys, io, os
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_json(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)

doc  = load_json("data/past_catalyst_predictions.json")
raw  = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

# ── helper: direzione corretta? ───────────────────────────────────────────────
def ok_v4(r):
    d = str(r.get("dir_v4") or r.get("direction") or "")
    # usa d3_pct poi d5_pct per valutare
    actual = None
    for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
        v = r.get(k)
        if v is not None:
            try: actual = float(v); break
            except: pass
    if actual is None or d == "":
        return None
    if d.startswith("↑"):   return actual > 0
    if d.startswith("↓"):   return actual < 0
    if d == "→ Stabile":    return abs(actual) < 5.0
    return None

# ── criteri eligibilità ───────────────────────────────────────────────────────
MIN_INPUTS = 11   # soglia _model_accuracy_metrics_eligible

def has_actual(r):
    for k in ("d3_pct","d5_pct","d3_actual","d5_actual"):
        if r.get(k) is not None: return True
    return False

def eligible_strict(r):
    """Stesso filtro di _model_accuracy_metrics_eligible (approssimato)."""
    if r.get("pred_dataset_incomplete"):   return False
    if r.get("non_quotata_al_tempo"):      return False
    n = r.get("model_inputs_present_n")
    if n is None:                          return False
    try:
        if int(float(n)) < MIN_INPUTS:     return False
    except: return False
    sm = str(r.get("sponsor_match") or r.get("sponsor_rel") or "").lower()
    if "exact" not in sm and "direct" not in sm:
        # accetta anche "partial" per non essere troppo restrittivo — vedere distribuzione
        pass
    return True

def eligible_loose(r):
    """Pool allargato: solo richiede d_actual presente e non non-quotata."""
    if r.get("non_quotata_al_tempo"): return False
    return has_actual(r)

# ── calcola hit rate per un sottoinsieme ─────────────────────────────────────
def hit_stats(subset, label):
    hits = wrongs = no_data = 0
    for r in subset:
        res = ok_v4(r)
        if res is True:  hits  += 1
        elif res is False: wrongs += 1
        else:            no_data += 1
    tot = hits + wrongs
    pct = hits/tot*100 if tot else 0
    print(f"  {label:<45}  N={tot:>5}  Hits={hits:>4}  Hit%={pct:5.1f}%  (no-data={no_data})")
    return pct, tot

print("=" * 80)
print("HIT% SU DIVERSI POOL — past_catalyst_predictions.json")
print("=" * 80)

all_with_actual = [r for r in rows if has_actual(r)]
strict          = [r for r in all_with_actual if eligible_strict(r)]
loose           = [r for r in all_with_actual if eligible_loose(r)]
incomplete_only = [r for r in all_with_actual if r.get("pred_dataset_incomplete")]
no_inputs_col   = [r for r in all_with_actual if r.get("model_inputs_present_n") is None]

print()
hit_stats(all_with_actual,  "TOTALE con actual (nessun filtro)")
hit_stats(loose,            "Pool loose  (actual + non non-quotata)")
hit_stats(strict,           "Pool strict (actual + ≥11 inputs + non incomplete)")
hit_stats(incomplete_only,  "Solo dataset_incomplete=True")
hit_stats(no_inputs_col,    "Senza colonna model_inputs_present_n (legacy)")

# ── breakdown per fascia input_n ─────────────────────────────────────────────
print()
print("BREAKDOWN per model_inputs_present_n (solo righe con actual):")
buckets = defaultdict(list)
for r in all_with_actual:
    n = r.get("model_inputs_present_n")
    if n is None:
        buckets["N/A"].append(r)
    else:
        try:
            ni = int(float(n))
            if ni <= 5:     buckets["0-5"].append(r)
            elif ni <= 8:   buckets["6-8"].append(r)
            elif ni <= 10:  buckets["9-10"].append(r)
            elif ni <= 11:  buckets["11"].append(r)
            else:           buckets["12+"].append(r)
        except:
            buckets["err"].append(r)

for k in ["N/A","0-5","6-8","9-10","11","12+"]:
    if buckets[k]:
        hit_stats(buckets[k], f"  inputs={k}")

# ── breakdown per fascia affidabilita ────────────────────────────────────────
print()
print("BREAKDOWN per affidabilita (al momento della predizione):")
aff_buckets = defaultdict(list)
for r in all_with_actual:
    a = r.get("affidabilita")
    if a is None: aff_buckets["N/A"].append(r)
    else:
        try:
            ai = int(float(a))
            if ai >= 80:        aff_buckets["80-95"].append(r)
            elif ai >= 65:      aff_buckets["65-79"].append(r)
            elif ai >= 50:      aff_buckets["50-64"].append(r)
            else:               aff_buckets["<50"].append(r)
        except:
            aff_buckets["err"].append(r)

for k in ["N/A","<50","50-64","65-79","80-95"]:
    if aff_buckets[k]:
        hit_stats(aff_buckets[k], f"  affidabilita={k}%")

# ── gap analysis: cosa esclude il filtro strict ───────────────────────────────
print()
print("COSA ESCLUDE IL FILTRO STRICT (righe con actual ma non nel pool strict):")
excluded = [r for r in all_with_actual if not eligible_strict(r)]
incomplete_excl = [r for r in excluded if r.get("pred_dataset_incomplete")]
low_inputs_excl = [r for r in excluded if not r.get("pred_dataset_incomplete") and
                   r.get("model_inputs_present_n") is not None and
                   int(float(r.get("model_inputs_present_n",0) or 0)) < MIN_INPUTS]
no_inputs_excl  = [r for r in excluded if r.get("model_inputs_present_n") is None]

print(f"  Totale escluse dal strict: {len(excluded)}")
print(f"    - pred_dataset_incomplete=True: {len(incomplete_excl)}")
print(f"    - inputs < {MIN_INPUTS}: {len(low_inputs_excl)}")
print(f"    - inputs colonna assente (legacy): {len(no_inputs_excl)}")
print()
hit_stats(incomplete_excl,  "  Escluse x incomplete")
hit_stats(low_inputs_excl,  "  Escluse x inputs bassi")

# ── direzione breakdown ───────────────────────────────────────────────────────
print()
print("BREAKDOWN per direzione predetta (pool loose):")
dir_buckets = defaultdict(list)
for r in loose:
    d = str(r.get("dir_v4") or r.get("direction") or "N/A")
    key = d[:3] if d else "N/A"
    dir_buckets[key].append(r)
for k, v in sorted(dir_buckets.items()):
    hit_stats(v, f"  direzione={k!r}")
