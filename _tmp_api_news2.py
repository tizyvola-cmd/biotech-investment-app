from daily_news_desk import _read, load_daily_news
import json

doc = _read()
print("file items", len(doc.get("items") or []), "top", len(doc.get("top_news") or []))
out = load_daily_news()
print("load hl", len(out.get("highlights") or []), "top", len(out.get("top_news") or []), "items", len(out.get("items") or []), "staged", out.get("staged_count"))
# dump first item statuses from file
for i in (doc.get("items") or [])[:3]:
    if isinstance(i, dict):
        print("file", i.get("id"), i.get("status"), i.get("migrated_to_eis"), str(i.get("title"))[:40])
