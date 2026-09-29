#!/usr/bin/env python3
import os, sys
from pathlib import Path
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
from daily_news_desk import load_daily_news, _brief_cache_get
d = load_daily_news()
fp = "683731ea259e38d54f25"
h = _brief_cache_get(fp, d)
print("SMMT_cached", bool(h))
print("briefs_total", len(d.get("briefs") or {}))
for it in list(d.get("top_news") or []) + list(d.get("items") or []):
    if not isinstance(it, dict):
        continue
    f = str(it.get("article_fp") or "")
    print(it.get("ticker"), "cached", bool(_brief_cache_get(f, d)), str(it.get("title") or "")[:50])
