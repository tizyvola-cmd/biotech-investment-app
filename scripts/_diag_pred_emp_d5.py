"""Diagnostica: perche' Pred +5 vale sempre 0.08% per tanti ticker?"""
from __future__ import annotations
import io, json, os, sys
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 1) Calibration state: mediane storiche per categoria
calib_path = os.path.join(ROOT, "data", "calibration_state.json")
if os.path.exists(calib_path):
    with open(calib_path, encoding="utf-8") as f:
        calib = json.load(f)
    cur = calib.get("current") or {}
    curves = cur.get("curves", {}).get("v4_options", {})
    print("=== Mediane storiche v4_options per categoria curva ===")
    for cat in ("success", "failure", "neutral", "control"):
        block = curves.get(cat) or {}
        n = block.get("n", 0)
        med = block.get("median", {}) or {}
        v_p5 = med.get("+5") or med.get(5) or med.get("5")
        v_p3 = med.get("+3") or med.get(3) or med.get("3")
        v_p10 = med.get("+10") or med.get(10) or med.get("10")
        v_p30 = med.get("+30") or med.get(30) or med.get("30")
        print(f"  {cat:8s} n={n:5d}  +3={v_p3}  +5={v_p5}  +10={v_p10}  +30={v_p30}")
    print()
else:
    print("calibration_state.json non trovato")

# 2) Past catalyst predictions: che pred_emp_d5 hanno?
past = os.path.join(ROOT, "data", "past_catalyst_predictions.json")
if os.path.exists(past):
    with open(past, encoding="utf-8") as f:
        doc = json.load(f)
    raw = doc.get("rows", {})
    rows = list(raw.values()) if isinstance(raw, dict) else list(raw)
    # Mantengo solo record futuri (predizione pending) — proxy: senza d5_pct
    pending = [r for r in rows if r.get("d5_pct") is None]
    print(f"Record totali: {len(rows)} | pending (no d5_pct): {len(pending)}")
    # Distribuzione pred_emp_d5
    c_pred_emp = Counter()
    c_cat = Counter()
    sample_05 = []
    for r in pending:
        pe = r.get("pred_emp_d5")
        if pe is None:
            c_pred_emp["<None>"] += 1
        else:
            c_pred_emp[f"{pe:.2f}"] += 1
        cat = r.get("emp_category", "?")
        c_cat[cat] += 1
        if pe is not None and abs(pe - 0.08) < 0.01:
            sample_05.append(r.get("ticker"))
    print(f"\n=== Distribuzione pred_emp_d5 (record pending) ===")
    for v, n in c_pred_emp.most_common(15):
        print(f"  pred={v!s:>10s}  ticker {n:4d}")
    print(f"\n=== Distribuzione emp_category (pending) ===")
    for v, n in c_cat.most_common(10):
        print(f"  {v!s:>20s}  n={n}")
    print(f"\n=== Primi 10 ticker con pred=0.08 ===")
    for t in sample_05[:10]:
        print(f"  {t}")
else:
    print("past_catalyst_predictions.json non trovato")

# 3) Confronto: pred_emp_d5 vs model_d5_pct (predizione "personalizzata")
print("\n=== Confronto pred_emp_d5 vs model_d5_pct (record pending) ===")
if os.path.exists(past):
    rows_with_both = 0
    same_value = 0
    distinct_model_d5 = Counter()
    for r in pending[:200]:
        pe = r.get("pred_emp_d5")
        md = r.get("model_d5_pct")
        if pe is not None:
            rows_with_both += 1
        if md is not None:
            distinct_model_d5[f"{md:.2f}"] += 1
    print(f"pending con pred_emp_d5 non-None: {rows_with_both}/200")
    print(f"\nmodel_d5_pct distinte (primi 200 pending): {len(distinct_model_d5)}")
    for v, n in distinct_model_d5.most_common(15):
        print(f"  model_d5_pct={v!s:>8s}  n={n}")
