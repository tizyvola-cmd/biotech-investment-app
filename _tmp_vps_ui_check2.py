import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")
for s in ("Catalyst Days", "Prossimi", "<=20", "≤20", "horizon", "CALENDAR"):
    print(s, js.count(s))
# snippets around Catalyst Days
for m in re.finditer(r".{0,40}Catalyst Days.{0,40}", js):
    print("SNIP:", m.group(0).replace("\n", " ")[:120])
# look for DESK horizon = 20
for m in re.finditer(r".{0,30}=20[,;\}.].{0,30}|horizonDays.{0,20}|≤\$\{.{0,40}", js):
    t = m.group(0)
    if "20" in t or "horizon" in t.lower():
        print("H:", t[:100])
        break
# brute: Prossimi ${e} or similar
for m in re.finditer(r"Prossimi.{0,80}", js):
    print("IT:", m.group(0)[:100])
    if m.start() > 5:
        break
