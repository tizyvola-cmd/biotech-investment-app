#!/usr/bin/env python3
import json
from pathlib import Path
p = Path("/opt/biotech/data/cache/daily_news_desk.json")
doc = json.loads(p.read_text(encoding="utf-8"))
# structure probe
print("top keys", list(doc)[:20] if isinstance(doc, dict) else type(doc))
items = []
if isinstance(doc, dict):
    for k in ("highlights", "items", "articles", "by_ticker", "tickers", "rows"):
        if k in doc:
            print("has", k, type(doc[k]))
    # deep search BIIB
    def walk(o, path=""):
        if isinstance(o, dict):
            title = str(o.get("title") or "")
            tk = str(o.get("ticker") or o.get("symbol") or "")
            if "BIIB" in tk.upper() or "biogen stock heads" in title.lower() or "1.6 percent slide" in title.lower():
                items.append((path, o))
            for kk, vv in o.items():
                walk(vv, path + "/" + str(kk)[:40])
        elif isinstance(o, list):
            for i, vv in enumerate(o[:5000]):
                walk(vv, path + f"[{i}]")
    walk(doc)
print("hits", len(items))
for path, o in items[:5]:
    print("===", path)
    keep = {k: o.get(k) for k in (
        "id","ticker","title","news_kind","clinical_score","financial_score","market_access_score",
        "taxonomy_method","taxonomy_audit","taxonomy_dimensions","summary_10w","detail_summary"
    ) if k in o or True}
    # print compact
    print("title:", (o.get("title") or "")[:120])
    print("news_kind:", o.get("news_kind"))
    print("scores:", o.get("clinical_score"), o.get("financial_score"), o.get("market_access_score"))
    print("method:", o.get("taxonomy_method"))
    print("audit:", o.get("taxonomy_audit"))
    dims = o.get("taxonomy_dimensions") or {}
    if isinstance(dims, dict):
        for d in ("clinical","financial","corporate","market_access"):
            b = dims.get(d) or {}
            if isinstance(b, dict) and (b.get("event_id") or b.get("score")):
                print(f"  {d}:", b.get("event_id"), b.get("score"), (b.get("evidence") or "")[:100], b.get("classification_method"))
