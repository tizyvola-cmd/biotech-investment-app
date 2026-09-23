#!/usr/bin/env python3
import os, re, requests
os.chdir("/opt/biotech")
import sys
sys.path.insert(0,"/opt/biotech")
from daily_news_desk import _HTTP_HEADERS, _extract_paywall_teaser_html
url="https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
r=requests.get(url,timeout=20,headers=_HTTP_HEADERS)
html=r.text
print("teaser_len", len(_extract_paywall_teaser_html(html)))
print("teaser", _extract_paywall_teaser_html(html)[:500])
# find articleBody raw context
idx=html.lower().find("articlebody")
print("idx", idx)
if idx>=0:
    print(html[idx:idx+400].replace("\n"," ")[:400])
