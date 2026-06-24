"""Diagnostica: estrae slope da histlib per posizioni simulate (ANIK + altre)."""
from __future__ import annotations
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HISTLIB = Path("data/model_historical_input_library.json")
OUTCOMES = Path("data/investment_sim_outcomes.json")

hist = json.loads(HISTLIB.read_text(encoding="utf-8"))
rows = hist.get("rows", {})

outcomes = json.loads(OUTCOMES.read_text(encoding="utf-8")) if OUTCOMES.is_file() else {}
sim_rows = outcomes.get("rows", [])

print(f"Sim positions in outcomes: {len(sim_rows)}")
print(f"Histlib total rows: {len(rows)}")
print()

for r in sim_rows:
    rk = r.get("row_key", "")
    ticker = r.get("ticker", "")
    cd = r.get("completion_date", "")
    key = f"{ticker}|{cd}"
    snap_blob = rows.get(key, {}).get("snapshots", {})
    print(f"== {ticker} (CD={cd}) ==")
    print(f"  P&L: {r.get('pnl_eur')}€ ({r.get('pnl_pct')}%) | outcome: {r.get('outcome')}")
    if not snap_blob:
        print(f"  histlib KEY NOT FOUND for '{key}'")
        # try alternative
        candidates = [k for k in rows if k.startswith(f"{ticker}|")]
        if candidates:
            print(f"  candidates with same ticker: {candidates[:3]}")
        continue
    for offs in ["T-10", "T-7", "T-5", "T-3", "T-1", "T+1", "T+3", "T+5", "T+7", "T+10"]:
        s = snap_blob.get(offs, {})
        if not s:
            continue
        s5 = s.get("slope_5d")
        s20 = s.get("slope_20d")
        ru30 = s.get("run_up_30d")
        asof = s.get("close_asof_date")
        print(f"  {offs}: slope_5d={s5!r}, slope_20d={s20!r}, run_up_30d={ru30!r}, asof={asof}")
    print()
