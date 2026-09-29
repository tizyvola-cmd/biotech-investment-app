#!/usr/bin/env python3
import os, sys, re
os.chdir("/opt/biotech")
sys.path.insert(0, "/opt/biotech")
import requests
from catalyst_extractor import _extract_text_from_html, _extract_html_page_title
from daily_news_desk import _clean_fetched_text, _strip_article_chrome, _HTTP_HEADERS

url = "https://www.rttnews.com/3692585/summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
r = requests.get(url, timeout=20, headers=_HTTP_HEADERS, allow_redirects=True)
print("status", r.status_code, "html_len", len(r.text))
html = r.text
title = _extract_html_page_title(html)
print("page_title", title)
raw = _extract_text_from_html(html, max_chars=50000)
print("extract_len", len(raw or ""))
print("extract_snip", (raw or "")[:500].replace("\n", " | "))
clean = _strip_article_chrome(_clean_fetched_text(raw or ""))
print("clean_len", len(clean), "clean_snip", clean[:400].replace("\n", " | "))
# check for paywall / login markers
for pat in ["subscribe", "sign in", "paywall", "premium", "article-body", "articleBody", "og:description"]:
    print(pat, bool(re.search(pat, html, re.I)))
# og:description
m = re.search(r'property=["\']og:description["\']\s+content=["\']([^"\']+)', html, re.I)
if not m:
    m = re.search(r'content=["\']([^"\']+)["\']\s+property=["\']og:description["\']', html, re.I)
print("og:desc", (m.group(1)[:300] if m else None))
