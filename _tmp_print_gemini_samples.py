#!/usr/bin/env python3
import json
from pathlib import Path

r = json.loads(Path(r"c:\coding\Biotech_Investment app 6\_tmp_8k_phase0_audit.json").read_text(encoding="utf-8"))
lines = []
for i, s in enumerate(r["gemini_samples_raw"], 1):
    lines.append(
        f"\n### {i}. {s['ticker']} · {s['filing_date']} · items={s['items_raw']} · "
        f"Fin={s['financial_score']} Clin={s['clinical_score']} Corp={s['corporate_score']}"
    )
    lines.append(f"**Title:** {s['title']}")
    for sess in s["sessions"]:
        lines.append(f"- **Item {sess.get('item')}** — *{sess.get('title')}*")
        lines.append(f"  - `{sess.get('summary')}`")
Path(r"c:\coding\Biotech_Investment app 6\_tmp_8k_gemini_samples.md").write_text(
    "\n".join(lines), encoding="utf-8"
)
print("wrote", len(lines), "lines")
