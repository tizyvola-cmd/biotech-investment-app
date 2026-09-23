#!/usr/bin/env python3
from __future__ import annotations
import os, sys
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
from daily_news_desk import load_daily_news, brief_daily_news_item, _brief_cache_get, _article_fingerprint

d = load_daily_news()
rows = [it for it in list(d.get("top_news") or []) + list(d.get("items") or []) if isinstance(it, dict)]
print("desk_rows", len(rows), "briefs_before", len(d.get("briefs") or {}))
if not rows:
    print("EMPTY_DESK")
    sys.exit(1)
row = rows[0]
title = str(row.get("title") or "")
url = str(row.get("resolved_link") or row.get("link") or "")
summary = str(row.get("summary") or "")
ticker = str(row.get("ticker") or "").upper()
iid = str(row.get("id") or "")
fp = str(row.get("article_fp") or "").strip() or _article_fingerprint(
    ticker=ticker, title=title, url=url, item_id=iid
)
print("pick", ticker, title[:60], "fp", fp[:16])
print("before_disk", bool(_brief_cache_get(fp, load_daily_news())))

res = brief_daily_news_item(title=title, url=url or None, summary=summary or None, ticker=ticker or None, item_id=iid or None)
print("userA", {"ok": res.get("ok"), "cached": res.get("cached"), "err": str(res.get("error") or "")[:100]})
d2 = load_daily_news()
print("after_A_disk", bool(_brief_cache_get(fp, d2)), "briefs_n", len(d2.get("briefs") or {}))

res2 = brief_daily_news_item(title=title, url=url or None, summary=summary or None, ticker=ticker or None, item_id=iid or None)
print("userB", {"ok": res2.get("ok"), "cached": res2.get("cached")})
print("briefs_final", len(load_daily_news().get("briefs") or {}))
