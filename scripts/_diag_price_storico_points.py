"""Diag: quanti punti hanno price_storico_usd != null per ticker."""
from __future__ import annotations
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
bundle = json.loads(Path("data/simulation_charts_snapshot.json").read_text(encoding="utf-8"))
series = bundle.get("series", {})

for t in ["OLMA", "BCAB", "BNTX", "PBYI"]:
    keys = [k for k in series if k.startswith(f"co:{t}|")]
    if not keys:
        print(f"\n== {t} == NO SERIES")
        continue
    print(f"\n== {t} ({keys[0]}) ==")
    pts = series[keys[0]].get("points", [])
    storico = [
        p for p in pts
        if p.get("price_storico_usd") is not None
    ]
    reale = [
        p for p in pts
        if p.get("pct_reale") is not None
    ]
    print(f"  totale punti: {len(pts)}")
    print(f"  con price_storico_usd: {len(storico)}")
    print(f"  con pct_reale: {len(reale)}")
    print(f"  offsets con price_storico_usd:")
    for p in storico[:15]:
        print(f"    off={p.get('offset')} nodo={p.get('nodo')!r:30} "
              f"data_raw={p.get('data_raw')} px={p.get('price_storico_usd')}")
    if len(storico) > 15:
        print(f"    ... +{len(storico) - 15} altri")
