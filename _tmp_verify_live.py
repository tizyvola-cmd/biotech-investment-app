import urllib.request
import re

base = "http://91.99.15.48:8765"

req = urllib.request.Request(base + "/api/health")
try:
    r = urllib.request.urlopen(req, timeout=15)
    print("health", r.status, r.read()[:200])
    print("health_cache", r.headers.get("Cache-Control"), r.headers.get("ETag"))
except Exception as e:
    print("health err", e)

r = urllib.request.urlopen(base + "/", timeout=15)
print("index_cache", r.headers.get("Cache-Control"), r.headers.get("ETag"))
h = r.read().decode("utf-8", "replace")
print("index_assets", re.findall(r"assets/index-[A-Za-z0-9_.-]+", h))

js = urllib.request.urlopen(base + "/assets/index-CA7DLSXJ.js", timeout=60).read().decode(
    "utf-8", "replace"
)
for s in [
    "catalystDesk",
    "simulation",
    "hideSignalBell",
    "NotificationBell",
    "signalBell",
]:
    print(s, js.find(s))

u = base + "/assets/FdaAdcomBriefingModal-DRes4pJ8.js"
fj = urllib.request.urlopen(u, timeout=30).read().decode("utf-8", "replace")
print("fda_len", len(fj))
for s in ["matchOk", "summary", "T-2", "company"]:
    print("fda", s, s in fj)

chunk = base + "/assets/CatalystDaysPage-NgWJ_e6p.js"
cj = urllib.request.urlopen(chunk, timeout=60).read().decode("utf-8", "replace")
print(
    "desk",
    {
        "Last Order th": 'children:"Last Order"' in cj,
        "d24 th": 'children:"\u039424h"' in cj or 'children:"Δ24h"' in cj,
        "Scheda prodotto": "Scheda prodotto" in cj,
        "Migra": "Migra" in cj,
        "table-fixed": "table-fixed" in cj,
    },
)
