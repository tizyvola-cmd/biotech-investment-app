"""Diagnostic: compare BOLD and FNCHQ data in the simulation snapshot."""
import json
import sys


def main() -> int:
    snap_path = r"data\simulation_charts_snapshot.json"
    try:
        with open(snap_path, "r", encoding="utf-8") as f:
            d = json.load(f)
    except FileNotFoundError:
        print(f"NOT FOUND: {snap_path}")
        return 2

    series = d.get("series", {})
    print(f"snapshot has {len(series)} series total")

    matches = [k for k in series.keys() if "BOLD" in k.upper() or "FNCHQ" in k.upper()]
    print(f"matching keys (BOLD|FNCHQ): {matches}")
    for k in matches:
        pts = series[k].get("points", [])
        print(f"  {k}: {len(pts)} pts")
        if pts:
            modello = [p.get("pct_modello") for p in pts]
            foglio = [p.get("pct_foglio") for p in pts]
            print(f"    pct_modello: {modello}")
            print(f"    pct_foglio:  {foglio}")

    bold_keys = [k for k in matches if "BOLD" in k.upper()]
    fnchq_keys = [k for k in matches if "FNCHQ" in k.upper()]

    if bold_keys and fnchq_keys:
        bk = bold_keys[0]
        fk = fnchq_keys[0]
        bpts = series[bk].get("points", [])
        fpts = series[fk].get("points", [])
        print()
        print(f"comparing first key for each:")
        print(f"  BOLD  -> {bk} ({len(bpts)} pts)")
        print(f"  FNCHQ -> {fk} ({len(fpts)} pts)")
        if len(bpts) == len(fpts):
            same_count = 0
            for a, b in zip(bpts, fpts):
                if (
                    a.get("offset") == b.get("offset")
                    and a.get("pct_curva") == b.get("pct_curva")
                    and a.get("pct_reale") == b.get("pct_reale")
                    and a.get("pct_foglio") == b.get("pct_foglio")
                ):
                    same_count += 1
            print(f"  identical points: {same_count}/{len(bpts)}")
        else:
            print(f"  different lengths: {len(bpts)} vs {len(fpts)}")

    sim_snap = r"data\simulation_sheet_snapshot.json"
    try:
        with open(sim_snap, "r", encoding="utf-8") as f:
            sim = json.load(f)
    except FileNotFoundError:
        sim = None
    if sim:
        rows = sim.get("rows", [])
        bold_rows = [r for r in rows if str(r.get("Ticker", "")).strip().upper() == "BOLD"]
        fnchq_rows = [r for r in rows if str(r.get("Ticker", "")).strip().upper() == "FNCHQ"]
        print()
        print(f"simulation_snapshot.json rows -> BOLD={len(bold_rows)} FNCHQ={len(fnchq_rows)}")
        for tag, lst in (("BOLD", bold_rows), ("FNCHQ", fnchq_rows)):
            for r in lst:
                cd = r.get("Completion Date")
                price = r.get("Prezzo USD") or r.get("Prezzo USD oggi") or r.get("Price USD")
                ticker = r.get("Ticker")
                print(f"  {tag} -> Ticker={ticker} CD={cd}  Price={price}")

    sds_path = r"data\sds_snapshot.json"
    try:
        with open(sds_path, "r", encoding="utf-8") as f:
            sds = json.load(f)
    except FileNotFoundError:
        sds = None
    if sds:
        rows = sds.get("rows", [])
        print()
        print(f"sds_cohort_snapshot.json rows: {len(rows)}")
        for tk in ("BOLD", "FNCHQ"):
            hits = [r for r in rows if str(r.get("ticker", "")).upper() == tk]
            for h in hits:
                print(f"  {tk} -> sds={h.get('sds')} cluster_a={h.get('cluster_a')} cluster_b={h.get('cluster_b')} cluster_c={h.get('cluster_c')} cluster_d={h.get('cluster_d')} days_to_cd={h.get('days_to_cd')}")
                print(f"        cluster_scores={h.get('cluster_scores')}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
