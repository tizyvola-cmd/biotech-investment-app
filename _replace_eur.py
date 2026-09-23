"""Replace all EUR sign (U+20AC) with $ (U+0024) in .ts/.tsx files under desktop-ui/src."""
import os
import pathlib

root = pathlib.Path(r"c:\coding\Biotech_Investment app 6\desktop-ui\src")
log_path = pathlib.Path(r"c:\coding\Biotech_Investment app 6\_replace_log.txt")
exts = {".ts", ".tsx"}
changed = 0
euro = "\u20ac"
dollar = "$"
log_lines = []

for fpath in root.rglob("*"):
    if fpath.suffix not in exts:
        continue
    content = fpath.read_text(encoding="utf-8")
    if euro not in content:
        continue
    new_content = content.replace(euro, dollar)
    fpath.write_text(new_content, encoding="utf-8", newline="")
    changed += 1
    log_lines.append(str(fpath))

result = f"Done. Changed {changed} files.\n" + "\n".join(log_lines)
log_path.write_text(result, encoding="utf-8")
print(result)
