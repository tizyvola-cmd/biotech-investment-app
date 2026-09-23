#!/usr/bin/env python3
"""Warm / verify SMMT RTTNews brief on VPS after soft-wall fix."""
from __future__ import annotations

import os
import sys
import time

os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")

from daily_news_desk import (
    _brief_cache_get,
    _fetch_url_text,
    brief_daily_news_item,
    load_daily_news,
)

url = (
    "https://www.rttnews.com/3692585/"
    "summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
)
title = (
    "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision "
    "- RTTNews"
)

t0 = time.time()
text, err = _fetch_url_text(url, title_hint=title, ticker_hint="SMMT", quick=False)
print(
    "fetch_len",
    len(text or ""),
    "err",
    err,
    "secs",
    round(time.time() - t0, 2),
    flush=True,
)
print((text or "")[:280], flush=True)

# Prefer live desk row id/fp if present
d = load_daily_news()
item_id = "ac2c3286be003b01"
fp = None
for it in list(d.get("top_news") or []) + list(d.get("items") or []):
    if not isinstance(it, dict):
        continue
    if str(it.get("ticker") or "").upper() != "SMMT":
        continue
    item_id = str(it.get("id") or item_id)
    fp = str(it.get("article_fp") or "") or None
    title = str(it.get("title") or title)
    url = str(it.get("resolved_link") or it.get("link") or url)
    print("desk_row", item_id, fp, title[:70], flush=True)
    break

t1 = time.time()
res = brief_daily_news_item(
    title=title, url=url, ticker="SMMT", item_id=item_id
)
print(
    "brief_secs",
    round(time.time() - t1, 1),
    "ok",
    res.get("ok"),
    "cached",
    res.get("cached"),
    "error",
    res.get("error"),
    flush=True,
)
b = res.get("brief") if isinstance(res, dict) else None
if isinstance(b, dict):
    print(
        "method",
        b.get("digest_method"),
        "detail_len",
        len(str(b.get("detail_summary") or "")),
        "sections",
        len(b.get("section_summaries") or []),
        "fetch_error",
        b.get("fetch_error"),
        flush=True,
    )
    print("detail:", str(b.get("detail_summary") or "")[:220], flush=True)
    fp2 = str(b.get("article_fp") or fp or "")
    d2 = load_daily_news()
    print("in_cache", bool(_brief_cache_get(fp2, d2)) if fp2 else "no_fp", flush=True)
