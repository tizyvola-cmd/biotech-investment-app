import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
print("index script:", m.group(1) if m else "MISSING")
if m:
    js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")
    for pat in (
        r"Next \d+ Catalyst Days",
        r"Prossimi \d+ Catalyst Days",
        r"already migrated or expired",
        r"già migrata o scaduta",
    ):
        found = re.findall(pat, js)
        print(pat, "->", found[:5] or "NOT FOUND")
