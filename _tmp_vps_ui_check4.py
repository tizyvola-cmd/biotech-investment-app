import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")

# Find all Si usages that look like horizon
for m in re.finditer(r".{0,50}\bSi\b.{0,50}", js):
    s = m.group(0)
    if any(x in s for x in ("Catalyst", "horizon", "giorni", "≤", "<=", "20", "30", "DESK")):
        print(s.replace("\n", " ")[:140])

# deskCalendarEvents export often: const DESK_CALENDAR_HORIZON_DAYS=20
for m in re.finditer(r"DESK_[A-Z_]*=\d+|CALENDAR_[A-Z_]*=\d+|HORIZON[A-Z_]*=\d+", js):
    print("CONST", m.group(0))

# numeric 20 near giorni
for m in re.finditer(r".{0,30}≤\$\{[^}]+\}g.{0,30}|Solo catalyst ≤.{0,40}", js):
    print("FOOT", m.group(0)[:120])
