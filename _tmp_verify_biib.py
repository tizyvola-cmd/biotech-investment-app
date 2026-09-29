#!/usr/bin/env python3
import json
from pathlib import Path
doc = json.loads(Path("/opt/biotech/data/cache/daily_news_desk.json").read_text(encoding="utf-8"))
for o in doc.get("items") or []:
    if "1.6 percent slide" in str(o.get("title") or ""):
        print("news_kind", o.get("news_kind"))
        print("scores", o.get("clinical_score"), o.get("financial_score"), o.get("corporate_score"))
        dims = o.get("taxonomy_dimensions") or {}
        for d in ("clinical", "financial", "corporate"):
            b = dims.get(d) or {}
            print(d, b.get("event_id"), b.get("score"), b.get("classification_method"))
