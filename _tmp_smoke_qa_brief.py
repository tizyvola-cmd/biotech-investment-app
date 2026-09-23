import json
import urllib.request

title = (
    "SLS Vs MLTX: Retail Traders Race To Pick Merck's Next Biotech Buyout "
    "As Keytruda's $31.7B Patent Cliff Nears"
)
payload = json.dumps(
    {"title": title, "ticker": "MLTX", "summary": title}
).encode()
req = urllib.request.Request(
    "http://91.99.15.48:8765/api/market/daily-news/brief",
    data=payload,
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as r:
    d = json.load(r)
b = d.get("brief") or {}
print("ok", d.get("ok"), "kind", b.get("news_kind"), "method", b.get("digest_method"))
print("has_bullet", b.get("has_bullet_summary"), "has_sum", b.get("has_summary"))
print("title", (b.get("title") or "")[:140])
print("detail", (b.get("detail_summary") or "")[:400])
print("invented", "target company" in (b.get("detail_summary") or "").lower())
print("answers", len(b.get("digest_answers") or []))
for a in (b.get("digest_answers") or [])[:6]:
    print(" Q", a.get("id"), "->", str(a.get("answer"))[:100])
print(
    "kr",
    [
        (x.get("label"), (x.get("detail") or "")[:90])
        for x in (b.get("key_results") or [])[:4]
    ],
)
