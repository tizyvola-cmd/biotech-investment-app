"""Quick polygon match distribution analysis."""
import json
import os

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "backtest_polygon_match.json")
OUT  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_poly_debug.txt")

with open(DATA, encoding="utf-8") as f:
    doc = json.load(f)

rows = doc.get("rows", {})
vals = list(rows.values())
print(f"Total polygon rows: {len(vals)}")

hist: dict[int, int] = {}
total_matches = 0
for r in vals:
    for v in [r.get("match_m10"), r.get("match_m30"), r.get("match_m60")]:
        if v is not None:
            total_matches += 1
            b = round(v / 5) * 5
            hist[b] = hist.get(b, 0) + 1

print(f"Total match values: {total_matches}\n")
print("Histogram (bucket 5%):")
for k in sorted(hist.keys()):
    bar = "#" * min(60, hist[k])
    print(f"  {k:3d}%: {hist[k]:3d} {bar}")

print(f"\nDeals with any match in 35-50% range:")
cluster = 0
for r in vals:
    for k, v in [("m10", r.get("match_m10")), ("m30", r.get("match_m30")), ("m60", r.get("match_m60"))]:
        if v is not None and 35 <= v <= 50:
            cluster += 1
            print(f"  {r.get('ticker', '?'):8s} {str(r.get('completion_date', '?'))[:10]} {k}={v}")

print(f"\nCluster 35-50% count: {cluster}")
