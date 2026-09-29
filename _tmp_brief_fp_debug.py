#!/usr/bin/env python3
import os, sys, json
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
from pathlib import Path
from daily_news_desk import _read, load_daily_news, _brief_cache_get, _article_fingerprint, brief_daily_news_item

raw = _read()
print("raw_keys", list(raw.keys())[:30])
print("raw_briefs", len(raw.get("briefs") or {}))
print("file_bytes", Path("data/cache/daily_news_desk.json").stat().st_size)
api = load_daily_news()
print("api_briefs", len(api.get("briefs") or {}))

rows = [it for it in list(api.get("top_news") or []) + list(api.get("items") or []) if isinstance(it, dict)]
row = rows[0]
title = str(row.get("title") or "")
url = str(row.get("resolved_link") or row.get("link") or "")
ticker = str(row.get("ticker") or "").upper()
iid = str(row.get("id") or "")
fp_row = str(row.get("article_fp") or "")
fp_calc = _article_fingerprint(ticker=ticker, title=title, url=url, item_id=iid)
print("ticker", ticker)
print("fp_row", fp_row)
print("fp_calc", fp_calc)
print("get_row", bool(_brief_cache_get(fp_row, raw)))
print("get_calc", bool(_brief_cache_get(fp_calc, raw)))
# show a few brief keys
briefs = raw.get("briefs") or {}
print("sample_brief_keys", list(briefs.keys())[:5])
