#!/usr/bin/env python3
from __future__ import annotations
import os, sys
from pathlib import Path
ROOT = Path("/opt/biotech")
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
from daily_news_desk import (
    load_daily_news,
    prefetch_daily_news_briefs,
    _brief_cache_get,
    brief_daily_news_item,
)

d = load_daily_news()
rows = []
seen = set()
for it in list(d.get("top_news") or []) + list(d.get("items") or []):
    if not isinstance(it, dict):
        continue
    fp = str(it.get("article_fp") or "").strip()
    if not fp or fp in seen:
        continue
    seen.add(fp)
    rows.append(it)
print("candidates", len(rows), flush=True)
for r in rows:
    print(" -", r.get("ticker"), str(r.get("title") or "")[:60], "cached", bool(_brief_cache_get(str(r.get("article_fp")), d)), flush=True)

# Warm SMMT first explicitly
smmt = next((r for r in rows if str(r.get("ticker") or "").upper() == "SMMT"), None)
if smmt:
    print("briefing SMMT…", flush=True)
    res = brief_daily_news_item(
        title=str(smmt.get("title") or ""),
        url=str(smmt.get("resolved_link") or smmt.get("link") or "") or None,
        summary=str(smmt.get("summary") or "") or None,
        ticker="SMMT",
        item_id=str(smmt.get("id") or "") or None,
    )
    print("SMMT ok", res.get("ok"), "cached_flag", res.get("cached"), "err", res.get("error"), flush=True)
    fp = str(smmt.get("article_fp") or "")
    d2 = load_daily_news()
    print("SMMT in cache after", bool(_brief_cache_get(fp, d2)), flush=True)

print("prefetch remaining max 5…", flush=True)
stats = prefetch_daily_news_briefs(rows, max_items=5)
print("stats", stats, flush=True)
