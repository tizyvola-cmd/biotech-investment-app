import json
from pathlib import Path

p = Path("/opt/biotech/data/yf_cache/GRAL.json")
print(p.exists(), json.loads(p.read_text()) if p.exists() else None)
