#!/usr/bin/env python3
import json
from pathlib import Path
doc = json.loads(Path("/opt/biotech/data/cache/daily_news_desk.json").read_text(encoding="utf-8"))
needle = "1.6 percent slide"
for section in ("items", "highlights", "top_news"):
    rows = doc.get(section) or []
    if not isinstance(rows, list):
        continue
    for i, o in enumerate(rows):
        if not isinstance(o, dict):
            continue
        if needle.lower() not in str(o.get("title") or "").lower():
            continue
        print("SECTION", section, "idx", i)
        print(json.dumps({
            "title": o.get("title"),
            "ticker": o.get("ticker"),
            "news_kind": o.get("news_kind"),
            "clinical_score": o.get("clinical_score"),
            "financial_score": o.get("financial_score"),
            "market_access_score": o.get("market_access_score"),
            "corporate_score": o.get("corporate_score"),
            "taxonomy_method": o.get("taxonomy_method"),
            "taxonomy_audit": o.get("taxonomy_audit"),
            "taxonomy_dimensions": o.get("taxonomy_dimensions"),
            "id": o.get("id"),
            "link": o.get("link") or o.get("url"),
        }, indent=2, ensure_ascii=False)[:4000])
        print("---")

briefs = doc.get("briefs") or {}
print("briefs type", type(briefs), "n", len(briefs) if isinstance(briefs, dict) else "?")
if isinstance(briefs, dict):
    for k, v in briefs.items():
        if not isinstance(v, dict):
            continue
        blob = json.dumps(v, ensure_ascii=False).lower()
        if "1.6 percent slide" in blob or "leqembi pen" in blob:
            print("BRIEF KEY", k)
            print(json.dumps({
                "title": v.get("title"),
                "ticker": v.get("ticker"),
                "news_kind": v.get("news_kind"),
                "clinical_score": v.get("clinical_score"),
                "financial_score": v.get("financial_score"),
                "market_access_score": v.get("market_access_score"),
                "taxonomy_method": v.get("taxonomy_method"),
                "taxonomy_audit": v.get("taxonomy_audit"),
                "taxonomy_dimensions": v.get("taxonomy_dimensions"),
            }, indent=2, ensure_ascii=False)[:4500])
            break
