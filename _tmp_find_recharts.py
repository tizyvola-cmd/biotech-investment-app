from pathlib import Path
import re

root = Path(r"c:\coding\Biotech_Investment app 6\desktop-ui\src")
start = root / "components" / "CatalystDaysPage.tsx"
seen: set[Path] = set()
q = [start]
recharts_hits: list[str] = []
imp_re = re.compile(r"""from\s+['"](\.\.?/[^'"]+)['"]""")

while q:
    p = q.pop()
    if p in seen or not p.exists():
        continue
    seen.add(p)
    text = p.read_text(encoding="utf-8", errors="ignore")
    if 'from "recharts"' in text or "from 'recharts'" in text:
        recharts_hits.append(str(p.relative_to(root)).replace("\\", "/"))
    for m in imp_re.finditer(text):
        rel = m.group(1)
        cand = (p.parent / rel).resolve()
        options = [
            cand if cand.suffix else Path(str(cand) + ".tsx"),
            Path(str(cand) + ".ts") if not cand.suffix else None,
            cand / "index.tsx",
            cand / "index.ts",
        ]
        for f in options:
            if f is None:
                continue
            try:
                f = f.resolve()
            except OSError:
                continue
            if f.exists() and f.suffix in (".ts", ".tsx") and root in f.parents:
                q.append(f)

print("files_scanned", len(seen))
print("recharts_hits", len(recharts_hits))
for h in sorted(recharts_hits):
    print(h)
