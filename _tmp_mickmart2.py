#!/usr/bin/env python3
import json
from pathlib import Path
for p in [
    Path("/opt/biotech/data/premium_beta_waitlist.json"),
    Path("/opt/biotech/data/contact_messages.json"),
]:
    if not p.is_file():
        print("missing", p)
        continue
    doc = json.loads(p.read_text(encoding="utf-8"))
    print("===", p.name, "keys", list(doc)[:8] if isinstance(doc, dict) else type(doc))
    raw = json.dumps(doc, ensure_ascii=False).lower()
    print("contains mickmart:", "mickmart" in raw)
    if isinstance(doc, dict):
        entries = doc.get("entries") or doc.get("messages") or []
        for e in entries:
            if isinstance(e, dict) and "mickmart" in json.dumps(e).lower():
                print(json.dumps(e, indent=2, ensure_ascii=False)[:500])
