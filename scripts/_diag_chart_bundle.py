"""Diag: contenuto curva pred completa per ticker dal bundle grafici."""
from __future__ import annotations
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

p = Path("data/simulation_charts_snapshot.json")
if not p.exists():
    p2 = Path("desktop-ui/data/simulation_charts_snapshot.json")
    if p2.exists():
        p = p2
    else:
        print("not found"); sys.exit(0)

d = json.loads(p.read_text(encoding="utf-8"))
ser = d.get("series", {})
print(f"path={p}, num_series={len(ser)}")
keys = list(ser.keys())
print(f"sample_keys={keys[:5]}")

# cerca OLMA, BCAB
for t in ["OLMA","BCAB","PBYI","ANIK"]:
    matching = [k for k in keys if t in k.upper()]
    print(f"\n{t}: matches={matching[:3]}")
    if matching:
        s = ser[matching[0]]
        if isinstance(s, dict):
            print(f"  keys: {list(s.keys())[:15]}")
            for k in ("points","series","data","pts"):
                if k in s:
                    pts = s[k]
                    if isinstance(pts, list):
                        print(f"  {k}: {len(pts)} pts, sample[:3]={pts[:3]}")
                        if pts and isinstance(pts[0], dict):
                            print(f"  point keys: {list(pts[0].keys())}")
                    break
            else:
                # dump il primo livello
                for k,v in s.items():
                    if isinstance(v, list):
                        print(f"  {k}: list[{len(v)}] sample={v[:2]}")
                    elif isinstance(v, (int,float,str,bool)) or v is None:
                        print(f"  {k}: {v!r}")
        elif isinstance(s, list):
            print(f"  list[{len(s)}] sample={s[:3]}")
