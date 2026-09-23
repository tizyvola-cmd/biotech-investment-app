#!/usr/bin/env python3
import json
import urllib.request

url = "http://127.0.0.1:8765/api/market/daily-news/brief"
payload = {
    "ticker": "BBNX",
    "title": "Other Events: Dilutive equity offering / shelf takedown",
    "url": "https://www.sec.gov/Archives/edgar/data/1674632/000119312526393322/d178069d8k.htm",
}
req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=90) as resp:
    body = json.loads(resp.read().decode("utf-8"))
brief = body.get("brief") or {}
secs = brief.get("section_summaries") or []
print("ok", body.get("ok"))
print("cached", body.get("cached"))
print("digest_method", brief.get("digest_method"))
print("n_section_summaries", len(secs))
print("n_item_summaries", len(brief.get("item_summaries") or []))
for i, s in enumerate(secs, 1):
    h = (s.get("heading") or "")[:80]
    sm = (s.get("summary") or "")[:160]
    print(f"--- {i} {h}")
    print(sm)
if not secs:
    print("DETAIL", str(brief.get("detail_summary") or "")[:400])
    print("FETCH", brief.get("fetch_error"))
