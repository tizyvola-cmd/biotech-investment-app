import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")
# Find the template and what Si is bound to
idx = js.find("Prossimi ${")
print("idx", idx)
print(js[idx - 200 : idx + 120])
# Find DESK_CALENDAR / Si= assignment near horizon
# Look for ,Si=20 or Si=20,
for pat in (r"\bSi=20\b", r"\bSi=30\b", r"=20[,;\}]", r"horizonDays:20", r"horizonDays:30"):
    print(pat, bool(re.search(pat, js)), len(re.findall(pat, js)))
# Extract const near template: often minifier does const Si=20
m2 = re.search(r"([A-Za-z_$][\w$]*)=20[,;].{0,80}Prossimi \$\{", js)
print("before Prossimi assign", m2.group(0)[:120] if m2 else None)
# reverse: find ${Si} and search Si=20 in file
m3 = re.search(r"Prossimi \$\{([A-Za-z_$][\w$]*)\} Catalyst Days", js)
if m3:
    var = m3.group(1)
    print("var", var)
    assigns = re.findall(rf"\b{re.escape(var)}=(\d+)", js)
    print("assigns", assigns[:10])
