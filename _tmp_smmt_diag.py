#!/usr/bin/env python3
"""Diagnose SMMT / RTTNews brief path quickly."""
from __future__ import annotations
import os, sys, time
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")

url = "https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
title = "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision - RTTNews"

print("1) fetch page…", flush=True)
t0 = time.time()
try:
    from daily_news_desk import _fetch_article_text
    # find actual fetch helper
except Exception as e:
    print("no _fetch_article_text", e, flush=True)

# probe common fetch functions
import daily_news_desk as desk
fetch_names = [n for n in dir(desk) if "fetch" in n.lower() or "page" in n.lower() or "http" in n.lower()]
print("fetch-ish", fetch_names[:30], flush=True)

# Try requests directly
print("2) raw requests…", flush=True)
try:
    import requests
    r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    print("status", r.status_code, "len", len(r.text), "secs", round(time.time()-t0,1), flush=True)
    print("snip", r.text[:200].replace("\n"," ")[:180], flush=True)
except Exception as e:
    print("requests fail", type(e).__name__, e, flush=True)

print("3) ai budget…", flush=True)
try:
    import ai_user_budget as aub
    print(aub.peek(aub.budget_key(tester_id="tizyvola_at_gmail.com", client_ip="1.1.1.1")), flush=True)
except Exception as e:
    print("budget", e, flush=True)

print("4) cache SMMT…", flush=True)
from daily_news_desk import _read, _brief_cache_get, _article_fingerprint
fp = _article_fingerprint(ticker="SMMT", title=title, url=url, item_id="ac2c3286be003b01")
print("fp", fp, "hit", bool(_brief_cache_get(fp, _read())), flush=True)

print("5) brief with 45s hard timeout via signal…", flush=True)
import threading
out = {}
def run():
    try:
        from daily_news_desk import brief_daily_news_item
        out["res"] = brief_daily_news_item(title=title, url=url, ticker="SMMT", item_id="ac2c3286be003b01")
    except Exception as e:
        out["err"] = f"{type(e).__name__}: {e}"

th = threading.Thread(target=run, daemon=True)
th.start()
th.join(45)
if th.is_alive():
    print("HUNG after 45s — brief path blocked", flush=True)
else:
    res = out.get("res") or {}
    print("done", {k: res.get(k) for k in ("ok","cached","error")} if isinstance(res, dict) else out, flush=True)
    b = res.get("brief") if isinstance(res, dict) else None
    if isinstance(b, dict):
        print("fetch_error", b.get("fetch_error"), "method", b.get("digest_method"), "detail_len", len(str(b.get("detail_summary") or "")), flush=True)
