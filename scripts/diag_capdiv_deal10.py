#!/usr/bin/env python3
"""Identify deal #10 in Three-Portfolio chronological walk + return sources."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def parse_pct(x):
    if x in (None, "", "—"):
        return None
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return None


def main():
    inputs = json.load(open(DATA / "invest_sim_inputs.json", encoding="utf-8"))["inputs"]
    sim = json.load(open(DATA / "simulation_sheet_snapshot.json", encoding="utf-8"))
    rows_by_ticker = {}
    rows_by_key = {}
    for r in sim.get("rows", []):
        tk = str(r.get("Ticker", "")).upper()
        cd = str(r.get("Completion Date") or r.get("CD") or "")
        key = f"{tk}|{cd}"
        rows_by_ticker[tk] = r
        rows_by_key[key] = r

    # Mine universe: capital > 0, not sold
    mine_keys = []
    for k, v in inputs.items():
        if float(v.get("capital") or 0) > 0 and not v.get("soldAt"):
            mine_keys.append(k)

    def entry_date(key):
        ent = inputs.get(key, {})
        if ent.get("purchaseDate"):
            return ent["purchaseDate"]
        if ent.get("investedAt"):
            return ent["investedAt"][:10]
        cd = key.split("|")[1] if "|" in key else ""
        return cd if cd and cd != "—" else "9999-12-31"

    mine_keys.sort(key=lambda k: (entry_date(k), k.split("|")[0]))
    today = "2026-07-06"
    today_idx = sum(1 for k in mine_keys if entry_date(k) <= today)

    print(f"Mine open positions: {len(mine_keys)}")
    print(f"TODAY marker idx (deals with entry <= {today}): {today_idx}")
    print()
    print("Chronological walk (mine deals only):")
    per_cap = 50000 / len(mine_keys) if mine_keys else 0
    for i, key in enumerate(mine_keys, 1):
        tk = key.split("|")[0]
        r = rows_by_key.get(key) or rows_by_ticker.get(tk, {})
        v24 = parse_pct(r.get("Var. Giorn. %") or r.get("Var. Giorn.%"))
        vt = parse_pct(r.get("Var.% totale") or r.get("Var. % totale"))
        cap = float(inputs[key].get("capital") or 0)
        marker = "  <-- TODAY boundary" if i == today_idx else ""
        marker2 = "  *** DEAL #10 ***" if i == 10 else ""
        print(
            f"  #{i:2d} {tk:5s}  entry={entry_date(key):10s}  cap_real={cap:6.0f}  "
            f"cap_equal~{per_cap:6.0f}  Var24h={v24 if v24 is not None else 'n/a':>7}  "
            f"VarTot={vt if vt is not None else 'n/a':>7}{marker}{marker2}"
        )
        if i == 10:
            pnl_eq_24 = per_cap * (v24 or 0) / 100
            pnl_eq_tot = per_cap * (vt or 0) / 100
            print(f"       Equal $ impact at step 10: +cap {per_cap:.0f}, 24h P&L ~{pnl_eq_24:+.0f}, total MTM ~{pnl_eq_tot:+.0f}")


if __name__ == "__main__":
    main()
