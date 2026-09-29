#!/usr/bin/env python3
"""Probe RTTNews HTML for extractable body text."""
from __future__ import annotations

import re
import requests

from daily_news_desk import (
    _HTTP_HEADERS,
    _clean_fetched_text,
    _extract_paywall_teaser_html,
    _strip_article_chrome,
)
from catalyst_extractor import _extract_html_page_title, _extract_text_from_html

url = (
    "https://www.rttnews.com/3692585/"
    "summit-therapeutics-smmt-time-to-take-a-look-ahead-of-the-fda-decision.aspx"
)
r = requests.get(url, timeout=20, headers=_HTTP_HEADERS, allow_redirects=True)
html = r.text or ""
print("status", r.status_code, "html_len", len(html))
print("title", _extract_html_page_title(html))
print("teaser", len(_extract_paywall_teaser_html(html)))
print("teaser_text:", _extract_paywall_teaser_html(html)[:400])
raw = _extract_text_from_html(html, max_chars=24000)
print("raw_extract", len(raw))
print(raw[:900])
print("--- chrome ---")
print(len(_strip_article_chrome(_clean_fetched_text(raw))))
# Look for longer paragraph blocks in HTML
paras = re.findall(r"<p[^>]*>\s*([^<]{80,800})\s*</p>", html, flags=re.I)
print("p_tags_long", len(paras))
for p in paras[:8]:
    print("P:", _clean_fetched_text(p)[:160])
# script JSON blobs
for m in re.finditer(r'"body"\s*:\s*"((?:\\.|[^"\\]){80,})"', html):
    print("body_json", len(m.group(1)), _clean_fetched_text(m.group(1))[:200])
