from daily_news_desk import (
    _fetch_url_text,
    _fetch_url_text_direct,
    _company_domain_candidates_from_title,
    _is_junk_news_host,
)

url = (
    "https://www.stocktitan.net/news/AZN/"
    "enhertu-recommended-for-approval-in-the-eu-by-chmp-as-adjuvant-2bk6b3ujpk53.html"
)
title = (
    "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
    "EU committee recommends it."
)
print("domains", _company_domain_candidates_from_title(title))
for d in ["astrazeneca.com", "astrazenecascancerdrug.com", "astrazeneca-cancer-drug.com"]:
    print("junk", d, _is_junk_news_host(d, title))
td, ed = _fetch_url_text_direct(url)
print("direct", len(td or ""), ed)
t, e = _fetch_url_text(url, title_hint=title, ticker_hint="AZN", quick=True)
print("quick", len(t or ""), e)
