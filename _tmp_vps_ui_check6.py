import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")

# DESK_CALENDAR_HORIZON_DAYS = CALENDAR_CATALYST → Si=hs
for pat in (r"Si=hs", r"hs=Si", r",Si=hs", r"Si=hs,", r"\{[^}]*Si:hs", r"hs as Si"):
    print(pat, bool(re.search(pat, js)))

idx = js.find("hs=20")
print("context:", js[idx - 80 : idx + 120])

# How AppTopBar imports DESK - search Prossimi and go back for import binding
# In rollup, often: import { DESK_CALENDAR_HORIZON_DAYS as Si }
# appears as ... from ... or just Si used after export {hs as Si} 
# Look for "as Si" or bindings after hs=20
print("after hs=20:", js[idx : idx + 200])
