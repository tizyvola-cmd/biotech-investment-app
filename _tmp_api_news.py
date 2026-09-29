import json, urllib.request
u = "http://127.0.0.1:8765/api/market/daily-news"
with urllib.request.urlopen(u, timeout=20) as r:
    d = json.load(r)
print("hl", len(d.get("highlights") or []))
print("top", len(d.get("top_news") or []))
print("items", len(d.get("items") or []))
print("staged", d.get("staged_count"), "count", d.get("count"))
hl = d.get("highlights") or []
if hl:
    print("hl0", (hl[0].get("title") or "")[:70], hl[0].get("status"), hl[0].get("migrated_to_eis"))
