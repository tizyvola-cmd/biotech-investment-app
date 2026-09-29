import requests
from daily_news_desk import _HTTP_HEADERS, _fetch_url_text_direct, _body_matches_headline

url = "https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-biib/biogen/news/biogen-biib-wins-china-approval-for-at-home-weekly-alzheimer"
title = "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment - simplywall.st"
t, e = _fetch_url_text_direct(url)
print("err", e, "len", len(t or ""), "match", _body_matches_headline(title, t or ""))
print((t or "")[:400])
