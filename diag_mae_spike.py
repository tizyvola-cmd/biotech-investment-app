from __future__ import annotations
from collections import defaultdict
from prediction.cluster_cal_factor import classify_ticker, collect_resolved_outcomes_from_sources

def _cluster_of(o):
    try:
        return classify_ticker(o.get("ticker_data") or {})
    except Exception:
        return "other"

def main():
    outcomes = collect_resolved_outcomes_from_sources()
    rows = [o for o in outcomes if o.get("pred") is not None and o.get("actual") is not None and str(o.get("date") or "")[:10]]
    print(f"Total resolved pred/actual pairs: {len(rows)}")
    if not rows:
        print("No dated outcomes found -- check data files."); return
    by_day = defaultdict(list)
    for o in rows:
        by_day[str(o["date"])[:10]].append(o)
    days = sorted(by_day)
    print("\n=== MAE per resolution day (most recent 12) ===")
    print(f"{'date':12s} {'n':>5s} {'MAE %':>8s} {'mean_err':>9s}")
    for d in days[-12:]:
        p = by_day[d]; n = len(p)
        mae = sum(abs(float(o["pred"]) - float(o["actual"])) for o in p) / n
        bias = sum(float(o["pred"]) - float(o["actual"]) for o in p) / n
        print(f"{d:12s} {n:5d} {mae:8.2f} {bias:+9.2f}")
    recent = days[-5:]
    worst = max(recent, key=lambda d: sum(abs(float(o["pred"]) - float(o["actual"])) for o in by_day[d]) / len(by_day[d]))
    pairs = sorted(by_day[worst], key=lambda o: abs(float(o["pred"]) - float(o["actual"])), reverse=True)
    print(f"\n=== Top error contributors on worst recent day: {worst} (n={len(pairs)}) ===")
    print(f"{'ticker':10s} {'node':5s} {'cluster':22s} {'pred':>8s} {'actual':>8s} {'|err|':>7s}")
    for o in pairs[:15]:
        err = abs(float(o["pred"]) - float(o["actual"]))
        print(f"{str(o.get('ticker')):10s} {str(o.get('node')):5s} {_cluster_of(o):22s} {float(o['pred']):8.2f} {float(o['actual']):8.2f} {err:7.2f}")
    cl = defaultdict(list)
    for o in by_day[worst]:
        cl[_cluster_of(o)].append(abs(float(o["pred"]) - float(o["actual"])))
    print(f"\n=== Per-cluster MAE on {worst} ===")
    for name, errs in sorted(cl.items(), key=lambda kv: -sum(kv[1]) / len(kv[1])):
        print(f"{name:22s} n={len(errs):3d}  MAE={sum(errs)/len(errs):6.2f}")

if __name__ == "__main__":
    main()
