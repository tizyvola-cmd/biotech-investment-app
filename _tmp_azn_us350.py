import re
from pathlib import Path

text = Path(
    r"C:\Users\tizyv\.cursor\projects\c-coding-Biotech-Investment-app-6\agent-tools\de86b0d6-ee2b-452e-98d1-8436d326c8d6.txt"
).read_text(encoding="utf-8", errors="ignore")

# Brand followed by FY 2024 geo header and Total Revenue WW US EM EU RoW
pat = re.compile(
    r"(?ms)^([A-Za-z][A-Za-z0-9/+® -]{1,40})\n"
    r"FY 2024, \$m Worldwide US Emerging Markets Europe Established RoW\n+"
    r"Total Revenue\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)"
)
rows = []
for m in pat.finditer(text):
    name = m.group(1).strip()
    ww = int(m.group(2).replace(",", ""))
    us = int(m.group(3).replace(",", ""))
    rows.append((us, name, ww))

# Enhertu markdown table variant
m_enh = re.search(
    r"(?is)Enhertu.{0,400}?Total Revenue\s+\|?\s*([\d,]+)\s*\|?\s*([\d,]+)",
    text,
)
if m_enh:
    ww = int(m_enh.group(1).replace(",", ""))
    us = int(m_enh.group(2).replace(",", ""))
    if not any(n == "Enhertu" for _, n, _ in rows):
        rows.append((us, "Enhertu", ww))

# Also try products with only Total Revenue line after brand (Lynparza style)
pat2 = re.compile(
    r"(?ms)^([A-Za-z][A-Za-z0-9/+® -]{1,40})\n(?:T o t\n+)?Total Revenue\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)"
)
for m in pat2.finditer(text):
    name = m.group(1).strip()
    if name in {n for _, n, _ in rows}:
        continue
    if name.lower() in {"region", "worldwide", "actual change", "cer change"}:
        continue
    ww = int(m.group(2).replace(",", ""))
    us = int(m.group(3).replace(",", ""))
    # sanity: US should be <= WW
    if us <= ww and ww > 100:
        rows.append((us, name, ww))

rows = sorted({(us, n, ww) for us, n, ww in rows}, reverse=True)
print("geo_tables", len(rows))
yes = []
for us, name, ww in rows:
    mark = "YES" if us >= 350 else "no "
    print(f"{mark} {name:20} US=${us:,}M  WW=${ww:,}M")
    if us >= 350:
        yes.append(name)
print("---")
print("COUNT US annual >= $350M:", len(yes))
print(yes)
