import json
import sys
from pathlib import Path

snap = Path(__file__).parent / "data" / "sds_snapshot.json"
if not snap.exists():
    print("SNAPSHOT NOT FOUND")
    sys.exit(1)

d = json.loads(snap.read_text(encoding="utf-8"))
rows = d.get("rows", [])
print(f"Total rows: {len(rows)}")

row = next((r for r in rows if r.get("ticker", "").upper() == "GRCE"), None)
if not row:
    print("GRCE not in snapshot")
    # Try first row
    if rows:
        row = rows[0]
        print(f"Using first row: {row.get('ticker')}")

ca = row.get("cause_attribution") if row else None
if ca:
    print(f"cause_attribution PRESENT: {json.dumps(ca, indent=2)[:500]}")
else:
    print("cause_attribution: MISSING / None")
    # Check if the field exists at all
    if row:
        print(f"Row keys sample: {list(row.keys())[-10:]}")
