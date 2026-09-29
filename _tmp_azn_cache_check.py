"""Quick VPS cache probe for AZN US product revenue."""
from __future__ import annotations

import json
from pathlib import Path

p = Path("data/us_product_revenue_ai_cache.json")
print("exists", p.exists(), "size", p.stat().st_size if p.exists() else 0)
d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
ents = d.get("entries") or {}
print("entries", len(ents))
for k, v in ents.items():
    if "AZN" not in str(k).upper():
        continue
    print(
        "AZN key",
        k,
        "schema",
        v.get("schema"),
        "n",
        len(v.get("products") or []),
        "updated",
        v.get("updated_at"),
    )
