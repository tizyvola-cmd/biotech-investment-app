"""
Analisi distributiva errori v4 su past_catalyst_predictions.json.
Esegui: python _diagnosi_bias.py
"""
from __future__ import annotations
import json, pathlib, math
from collections import defaultdict

doc = json.loads(pathlib.Path("data/past_catalyst_predictions.json").read_text(encoding="utf-8"))
rows = list(doc.get("rows", {}).values())
print(f"Righe totali nel JSON: {len(rows)}")

def _f(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None

# Calcola errore firmato: pred_t7 - actual_t7 (vs baseline T-60)
errors, runup_buckets, dir_errors = [], defaultdict(list), defaultdict(list)

for r in rows:
    pred   = _f(r.get("model_d7_pct"))
    c_p7   = _f(r.get("close_p7"))
    c_m60  = _f(r.get("close_m60"))
    run_up = _f(r.get("run_up_30d"))
    dir_v4 = str(r.get("dir_v4") or r.get("direction") or "")

    if pred is None or c_p7 is None or c_m60 is None or c_m60 <= 0:
        continue

    actual = (c_p7 / c_m60 - 1.0) * 100.0
    err    = pred - actual
    errors.append(err)

    # Bucket run_up
    if run_up is not None:
        if   run_up < 0:   bucket = "run_up < 0%"
        elif run_up < 5:   bucket = "0–5%"
        elif run_up < 15:  bucket = "5–15%"
        elif run_up < 30:  bucket = "15–30%"
        else:              bucket = "> 30%"
        runup_buckets[bucket].append(err)

    # Per direzione
    if dir_v4:
        dir_errors[dir_v4[:2]].append(err)

def stats(vals):
    if not vals: return "n=0"
    n   = len(vals)
    avg = sum(vals) / n
    mae = sum(abs(e) for e in vals) / n
    pos = sum(1 for e in vals if e > 0)
    return f"n={n:4d}  bias={avg:+7.1f}pp  MAE={mae:5.1f}pp  sovrastima={pos/n*100:.0f}%"

print("\n── Errore globale (pred T+7 − reale T+7) ──────────────────────────")
print(f"  {stats(errors)}")
print("  bias negativo = SOTTOSTIMA, positivo = SOVRASTIMA\n")

print("── Per bucket run_up 30gg ─────────────────────────────────────────")
for b in ["run_up < 0%", "0–5%", "5–15%", "15–30%", "> 30%"]:
    v = runup_buckets.get(b, [])
    print(f"  {b:<14} {stats(v)}")

print("\n── Per direzione v4 ───────────────────────────────────────────────")
for d in sorted(dir_errors):
    print(f"  {d:<6} {stats(dir_errors[d])}")

# Distribuzione degli errori (istogramma testuale)
print("\n── Distribuzione errori (pred − reale) ────────────────────────────")
bins = [(-200,-50),(-50,-30),(-30,-15),(-15,-5),(-5,5),(5,15),(15,30),(30,50),(50,200)]
labels = ["< -50","-50/-30","-30/-15","-15/-5","-5/+5","+5/+15","+15/+30","+30/+50","> +50"]
for (lo, hi), lbl in zip(bins, labels):
    n = sum(1 for e in errors if lo <= e < hi)
    bar = "█" * (n // max(len(errors)//50, 1))
    print(f"  {lbl:>9}pp  {n:4d}  {bar}")
