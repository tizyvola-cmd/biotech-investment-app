#!/usr/bin/env python3
"""Merge local FDA briefing Daily News rows + AdCom snapshot onto VPS."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    incoming_news = Path(sys.argv[1])
    incoming_snap = Path(sys.argv[2])
    news_path = Path("/opt/biotech/data/cache/daily_news_desk.json")
    snap_path = Path("/opt/biotech/data/fda_adcom_calendar_snapshot.json")

    src = json.loads(incoming_news.read_text(encoding="utf-8"))
    fda_rows = [
        i
        for i in (src.get("items") or [])
        if isinstance(i, dict) and str(i.get("source_kind") or "") == "fda_briefing"
    ]
    print(f"incoming fda_briefing={len(fda_rows)}")

    doc = {}
    if news_path.is_file():
        doc = json.loads(news_path.read_text(encoding="utf-8"))
    items = [i for i in (doc.get("items") or []) if isinstance(i, dict)]
    top = [i for i in (doc.get("top_news") or []) if isinstance(i, dict)]
    # Drop prior fda_briefing rows so we replace with the backfill set.
    items = [i for i in items if str(i.get("source_kind") or "") != "fda_briefing"]
    top = [i for i in top if str(i.get("source_kind") or "") != "fda_briefing"]
    for row in reversed(fda_rows):
        items.insert(0, row)
        top.insert(0, row)
    doc["items"] = items[:200]
    doc["top_news"] = top[:40]
    news_path.parent.mkdir(parents=True, exist_ok=True)
    news_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {news_path} items={len(doc['items'])} fda={len(fda_rows)}")

    if incoming_snap.is_file():
        snap_path.write_text(incoming_snap.read_text(encoding="utf-8"), encoding="utf-8")
        snap = json.loads(snap_path.read_text(encoding="utf-8"))
        print(
            f"wrote {snap_path} briefings_ready={snap.get('briefings_ready')} rows={snap.get('count')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
