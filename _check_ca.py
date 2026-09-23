import json, os, traceback

out_path = r"c:\coding\Biotech_Investment app 6\_check_ca_output.txt"
path = r"c:\coding\Biotech_Investment app 6\data\sds_snapshot.json"

try:
    out_lines = []
    if not os.path.exists(path):
        out_lines.append(f"FILE NOT FOUND: {path}")
    else:
        out_lines.append(f"File size: {os.path.getsize(path)} bytes")
        with open(path, "r", encoding="utf-8") as f:
            d = json.load(f)
        tickers = list(d.keys())[:5]
        out_lines.append(f"Total tickers: {len(d)}")
        out_lines.append(f"First 5: {tickers}")
        for t in tickers[:3]:
            row = d[t]
            keys = list(row.keys())
            ca = row.get("cause_attribution")
            out_lines.append(f"\n--- {t} ---")
            out_lines.append(f"  keys count: {len(keys)}")
            out_lines.append(f"  has cause_attribution key: {'cause_attribution' in row}")
            out_lines.append(f"  cause_attribution: {json.dumps(ca)[:500] if ca else 'None'}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))
except Exception:
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(traceback.format_exc())
