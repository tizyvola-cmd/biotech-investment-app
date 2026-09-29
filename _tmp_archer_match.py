# -*- coding: utf-8 -*-
import re

import requests

from daily_news_desk import (
    _HTTP_HEADERS,
    _fetch_via_stock_titan,
    _score_headline_match,
    _search_and_fetch_article,
)

title = "Cardiol Therapeutics announced positive Phase II ARCHER-CMF topline results for"
t, u, e = _search_and_fetch_article(title)
print("search", e, "url", u, "len", len(t or ""))
print((t or "")[:400].encode("ascii", "replace").decode())

r = requests.get(
    "https://www.stocktitan.net/news/CRDL/", timeout=25, headers=_HTTP_HEADERS
)
html = r.text
cands = []
for m in re.finditer(
    r'"headline"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"url"\s*:\s*'
    r'"(https://www\.stocktitan\.net/news/CRDL/[^"]+\.html)"',
    html,
):
    h = m.group(1)
    url = m.group(2)
    cands.append((_score_headline_match(title, h), h[:90], url))
cands.sort(reverse=True)
print("top candidates:")
for c in cands[:10]:
    print(c[0], "|", c[1])

t1, e1 = _fetch_via_stock_titan("CRDL", title)
print("st fetch len", len(t1 or ""), "err", e1)
print("ARCHER" in (t1 or "").upper(), "topline" in (t1 or "").lower())
print((t1 or "")[:300].encode("ascii", "replace").decode())
