#!/usr/bin/env python3
import os, sys, time
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
from urllib.parse import urlparse
from daily_news_desk import (
    _is_blocked_news_host,
    _fetch_url_text,
    _fetch_url_text_direct,
    _BRIEF_TIME_BUDGET_S,
)

url = "https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
title = "Summit Therapeutics (SMMT): Time To Take A Look Ahead Of The FDA Decision - RTTNews"
host = urlparse(url).netloc
print("host", host, "blocked", _is_blocked_news_host(host), flush=True)

t0 = time.time()
text, err = _fetch_url_text_direct(url, timeout_s=15.0)
print("direct", "len", len(text or ""), "err", err, "secs", round(time.time()-t0,1), flush=True)
if text:
    print("body_snip", text[:240].replace("\n"," "), flush=True)

t0 = time.time()
text2, err2 = _fetch_url_text(url, title_hint=title, ticker_hint="SMMT", quick=True)
print("fetch_url_text quick", "len", len(text2 or ""), "err", err2, "secs", round(time.time()-t0,1), flush=True)
