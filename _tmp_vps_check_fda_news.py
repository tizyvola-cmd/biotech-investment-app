import json, urllib.request
raw = urllib.request.urlopen("http://127.0.0.1:8765/api/market/daily-news", timeout=30).read()
d = json.loads(raw)
items = list(d.get("items") or []) + list(d.get("top_news") or [])
seen = set()
fda = []
for i in items:
    if not isinstance(i, dict):
        continue
    if i.get("source_kind") != "fda_briefing":
        continue
    rid = i.get("id")
    if rid in seen:
        continue
    seen.add(rid)
    fda.append(i)
print("fda_briefing", len(fda))
for i in fda:
    print(i.get("ticker"), (i.get("title") or "")[:60])
