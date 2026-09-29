import re
import urllib.request

html = urllib.request.urlopen("http://127.0.0.1:8765/", timeout=15).read().decode("utf-8", "ignore")
m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
js = urllib.request.urlopen(f"http://127.0.0.1:8765{m.group(1)}", timeout=30).read().decode("utf-8", "ignore")

# Find declaration of Si - often `,Si=20` or `Si=20,`
cands = re.findall(r"(?:const|let|var|,|\n)Si\s*=\s*([^,;\n]{1,40})", js)
print("Si assigns", cands[:20])
# Also hs used in calendar panel
cands2 = re.findall(r"(?:const|let|var|,|\n)hs\s*=\s*([^,;\n]{1,40})", js)
print("hs assigns", cands2[:20])
# Maybe both come from same: export const X=20
# Search for pattern like 20 and nearby DESK in source map? no map.
# Look at import { Si as ... } from - minified as Si from module
# In single bundle: function or IIFE with Si=20 early
for m in re.finditer(r"Si=(\d+)", js):
    print("Si=", m.group(1), "at", m.start())
for m in re.finditer(r"hs=(\d+)", js):
    print("hs=", m.group(1), "at", m.start())
# calendarPhase1: =20 after FORWARD=180
idx = js.find("=180")
print("near 180:", js[idx : idx + 80] if idx >= 0 else None)
# try 180,20 pattern
m = re.search(r"=180[,;].{0,60}=20\b", js)
print("180 then 20", m.group(0) if m else None)
m = re.search(r"=180[,;].{0,60}=30\b", js)
print("180 then 30", m.group(0) if m else None)
