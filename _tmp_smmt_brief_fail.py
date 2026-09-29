#!/usr/bin/env python3
from __future__ import annotations
import os, sys, json
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
from daily_news_desk import load_daily_news, brief_daily_news_item, _brief_cache_get

d = load_daily_news()
row = None
for it in list(d.get("top_news") or []) + list(d.get("items") or []) + list(d.get("highlights") or []):
    if not isinstance(it, dict):
        continue
    title = str(it.get("title") or "")
    if "SMMT" in str(it.get("ticker") or "").upper() or "Summit Therapeutics" in title:
        row = it
        break
print("row_found", bool(row))
if not row:
    # try by URL fragment
    for it in list(d.get("top_news") or []) + list(d.get("items") or []):
        if isinstance(it, dict) and "rttnews.com/3692585" in str(it.get("link") or it.get("resolved_link") or ""):
            row = it
            break
if not row:
    print("forcing synthetic")
    row = {
        "title": "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision - RTTNews",
        "ticker": "SMMT",
        "link": "https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-d",
        "resolved_link": "https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx",
        "id": "ac2c3286be003b01",
        "article_fp": "683731ea259e38d54f25",
        "summary": "",
    }
print("ticker", row.get("ticker"), "id", row.get("id"))
print("title", str(row.get("title") or "")[:80])
print("link", str(row.get("resolved_link") or row.get("link") or "")[:120])
fp = str(row.get("article_fp") or "")
print("fp", fp, "cached", bool(_brief_cache_get(fp, d)))

res = brief_daily_news_item(
    title=str(row.get("title") or ""),
    url=str(row.get("resolved_link") or row.get("link") or "") or None,
    summary=str(row.get("summary") or "") or None,
    ticker=str(row.get("ticker") or "") or None,
    item_id=str(row.get("id") or "") or None,
)
print("ok", res.get("ok"), "cached", res.get("cached"), "error", res.get("error"))
brief = res.get("brief") if isinstance(res.get("brief"), dict) else {}
print("digest_method", brief.get("digest_method"))
print("fetch_error", brief.get("fetch_error"))
print("detail_len", len(str(brief.get("detail_summary") or "")))
print("sections", len(brief.get("section_summaries") or []))
print("clin", brief.get("clinical_score"), "fin", brief.get("financial_score"), "acc", brief.get("market_access_score"))
# dump small error keys
for k in ("ok", "error", "article_fp", "elapsed_ms"):
    if k in res:
        print(k, res.get(k))
