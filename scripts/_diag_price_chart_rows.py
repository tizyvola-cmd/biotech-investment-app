"""Diag: simula pricePointsFromSeries + aggregateRowsByOffset per ogni ticker."""
from __future__ import annotations
import io
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

bundle = json.loads(Path("data/simulation_charts_snapshot.json").read_text(encoding="utf-8"))
series = bundle.get("series", {})

FIELD = "price_storico_usd"  # quello usato da "Andamento prezzo $"

for t in ["OLMA", "BCAB", "BNTX", "PBYI"]:
    keys = [k for k in series if k.startswith(f"co:{t}|")]
    if not keys:
        print(f"\n== {t} == NOT FOUND")
        continue
    pts = series[keys[0]].get("points", [])
    rows = []
    for p in pts:
        nodo = p.get("nodo") or "standard"
        if nodo not in ("standard", "K-8"):
            continue
        v = p.get(FIELD)
        if v is None:
            continue
        try:
            v = float(v)
        except Exception:
            continue
        rows.append({"offset": p.get("offset"), "y": v, "nodo": nodo})

    # aggregateRowsByOffset
    by_x = defaultdict(list)
    for r in rows:
        by_x[r["offset"]].append(r["y"])
    agg = sorted(by_x.items())

    print(f"\n== {t} ({keys[0]}) ==")
    print(f"  raw rows (storici): {len(rows)}")
    print(f"  unique offsets aggregati: {len(agg)}")
    if len(agg) < 2:
        print("  ⚠ AGGREGATI < 2 -> serie ESCLUSA dal chart (filter rows.length >= 2)")
    has_t60 = any(off == -60 for off, _ in agg)
    print(f"  contiene offset -60: {has_t60} (base normalizzazione)")
    print("  primi 8 offset aggregati [offset: mean (n)]:")
    for off, ys in agg[:8]:
        m = statistics.mean(ys)
        sd = statistics.stdev(ys) if len(ys) > 1 else 0.0
        print(f"    {off:+d}: {m:.2f} ± {sd:.2f}  n={len(ys)}")
