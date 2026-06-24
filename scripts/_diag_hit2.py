"""Analisi vera dei dati: hit rate per direzione, per fascia affidabilita, con correzioni."""
import json, sys, io, os, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ROOT, "data/past_catalyst_predictions.json"), encoding="utf-8") as f:
    doc = json.load(f)
raw = doc.get("rows", {})
rows = list(raw.values()) if isinstance(raw, dict) else list(raw)

def has_actual(r):
    for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
        if r.get(k) is not None: return True
    return False

def get_actual(r):
    for k in ("d3_pct", "d5_pct", "d3_actual", "d5_actual"):
        v = r.get(k)
        if v is not None:
            try: return float(v)
            except: pass
    return None

def eval_direction(d, actual):
    """Valuta se la direzione era corretta."""
    if not d or actual is None:
        return None
    d = str(d)
    if d.startswith("↑"):   return actual > 0
    if d.startswith("↓"):   return actual < 0
    if "Stab" in d or d.startswith("→"):  return abs(actual) < 5.0
    return None

def hit_table(subset, label):
    hits = wrongs = nd = 0
    for r in subset:
        d = str(r.get("dir_v4") or r.get("direction") or "")
        actual = get_actual(r)
        res = eval_direction(d, actual)
        if res is True:   hits += 1
        elif res is False: wrongs += 1
        else:              nd += 1
    tot = hits + wrongs
    pct = hits/tot*100 if tot > 0 else float("nan")
    print(f"  {label:<48} tot={tot:>5}  hits={hits:>4}  hit%={pct:5.1f}%  nd={nd}")

all_rows  = [r for r in rows if has_actual(r)]
print(f"Totale records: {len(rows):>6}")
print(f"Con actual:     {len(all_rows):>6}")
print()

# ── Zero affidabilita ─────────────────────────────────────────────────────────
zero_aff   = [r for r in all_rows if r.get("affidabilita", 0) == 0]
nonzero_aff = [r for r in all_rows if r.get("affidabilita", 0) != 0]
print(f"Con affidabilita=0:  {len(zero_aff)} ({len(zero_aff)/len(all_rows)*100:.0f}%) — probabilmente predizioni legacy/non-generate")
print(f"Con affidabilita>0:  {len(nonzero_aff)}")
print()

# ── Campione affidabilita=0 ───────────────────────────────────────────────────
print("Campione aff=0 (prime 8 righe con actual):")
for r in zero_aff[:8]:
    d  = str(r.get("dir_v4") or r.get("direction") or "—")[:15]
    a3 = r.get("d3_pct")
    a5 = r.get("d5_pct")
    inp = r.get("model_inputs_present_n")
    inc = r.get("pred_dataset_incomplete")
    print(f"    dir={d!r:18}  d3={str(a3)[:6]}  d5={str(a5)[:6]}  inputs={inp}  incomplete={inc}")
print()

# ── Hit rate per direzione (solo aff>0) ──────────────────────────────────────
print("HIT% PER DIREZIONE (solo records con affidabilita>0, esclude aff=0):")
dir_buckets = collections.defaultdict(list)
for r in nonzero_aff:
    d = str(r.get("dir_v4") or r.get("direction") or "—")
    if d.startswith("↑↑"):   key = "↑↑ Forte rialzo"
    elif d.startswith("↑"):  key = "↑  Rialzo"
    elif d.startswith("↓↓"): key = "↓↓ Forte ribasso"
    elif d.startswith("↓"):  key = "↓  Ribasso"
    elif d.startswith("→"):  key = "→  Stabile (±5%)"
    else:                    key = "? Altro: " + d[:10]
    dir_buckets[key].append(r)

for k in ["↑↑ Forte rialzo","↑  Rialzo","→  Stabile (±5%)","↓  Ribasso","↓↓ Forte ribasso"]:
    if dir_buckets[k]:
        hit_table(dir_buckets[k], k)
for k, v in dir_buckets.items():
    if k not in ["↑↑ Forte rialzo","↑  Rialzo","→  Stabile (±5%)","↓  Ribasso","↓↓ Forte ribasso"]:
        hit_table(v, k)
print()

# ── Hit rate per fascia affidabilita (solo aff>0) ─────────────────────────────
print("HIT% PER FASCIA AFFIDABILITA (solo aff>0):")
aff_buckets = collections.defaultdict(list)
for r in nonzero_aff:
    ai = int(r.get("affidabilita", 0))
    if ai < 50:       aff_buckets["30-49%"].append(r)
    elif ai < 65:     aff_buckets["50-64%"].append(r)
    elif ai < 80:     aff_buckets["65-79%"].append(r)
    else:             aff_buckets["80-95%"].append(r)

for k in ["30-49%","50-64%","65-79%","80-95%"]:
    if aff_buckets[k]:
        hit_table(aff_buckets[k], f"Affidabilita {k}")
print()

# ── Hit rate per fascia affidabilita SOLO DIREZIONALE (no Stabile) ────────────
print("HIT% DIREZIONALE (esclude 'Stabile') per fascia affidabilita:")
dir_only = [r for r in nonzero_aff
            if str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]
print(f"  Predizioni direzionali totali: {len(dir_only)}")
aff_dir = collections.defaultdict(list)
for r in dir_only:
    ai = int(r.get("affidabilita", 0))
    if ai < 50:       aff_dir["30-49%"].append(r)
    elif ai < 65:     aff_dir["50-64%"].append(r)
    elif ai < 80:     aff_dir["65-79%"].append(r)
    else:             aff_dir["80-95%"].append(r)

for k in ["30-49%","50-64%","65-79%","80-95%"]:
    if aff_dir[k]:
        hit_table(aff_dir[k], f"Dir. Affidabilita {k}")
print()

# ── Quante stabile vs direzionali ─────────────────────────────────────────────
stab = [r for r in nonzero_aff if str(r.get("dir_v4") or r.get("direction","")).startswith("→")]
direz = [r for r in nonzero_aff if str(r.get("dir_v4") or r.get("direction","")).startswith(("↑","↓"))]
print(f"Proporzioni (aff>0): Stabile={len(stab)} ({len(stab)/len(nonzero_aff)*100:.0f}%)  Direzionale={len(direz)} ({len(direz)/len(nonzero_aff)*100:.0f}%)")

# ── Summary finale ─────────────────────────────────────────────────────────────
print()
print("=" * 70)
print("RIEPILOGO")
print("=" * 70)
hit_table(all_rows,   "Tutto (incluso aff=0)")
hit_table(nonzero_aff,"Solo aff>0 (esclude legacy)")
hit_table(stab,        "Solo → Stabile (aff>0)")
hit_table(direz,       "Solo direzionali ↑/↓ (aff>0)")
strict = [r for r in nonzero_aff
          if not r.get("pred_dataset_incomplete")
          and r.get("model_inputs_present_n") is not None
          and int(float(r.get("model_inputs_present_n",0) or 0)) >= 11]
hit_table(strict,      "Pool strict ≥11 inputs (aff>0)")
