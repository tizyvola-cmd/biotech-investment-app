"""Diag: cosa contengono davvero le colonne Pred -60..Pred +7 per i ticker?

Verifichiamo se sono valori del modello v4 ricalibrato (curva fit) o se sono
prezzi storici osservati.
"""
from __future__ import annotations
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

d = json.loads(Path("data/simulation_sheet_snapshot.json").read_text(encoding="utf-8"))
rows = d.get("rows", [])

for t in ["OLMA", "BCAB", "PBYI", "BNTX", "CLRB", "ANIK"]:
    r = next((x for x in rows if str(x.get("Ticker", "")).strip() == t), None)
    if not r:
        print(f"{t}: NOT FOUND")
        continue
    print(f"\n== {t} ==")
    for k, v in r.items():
        if "Pred" in k and "Δ" in k:
            ck = k.replace("\n", " ")
            print(f"  {ck!r} = {v!r}")
    # Anche pred empirica
    for k, v in r.items():
        if "empirica" in k or "Inferenza" in k:
            ck = k.replace("\n", " ")
            print(f"  {ck!r} = {v!r}")
