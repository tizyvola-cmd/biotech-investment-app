from daily_news_desk import (
    _company_domain_candidates_from_title,
    _fetch_article_via_title_search,
    _fetch_via_company_ir_press,
)

title = (
    "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
    "EU committee recommends it. - Stock Titan"
)
t, e = _fetch_article_via_title_search(title)
print("title_search", len(t or ""), e)
print((t or "")[:240])
print("domains", _company_domain_candidates_from_title(title))
title2 = title.split(" - ")[0]
print("domains2", _company_domain_candidates_from_title(title2))
ti, ei = _fetch_via_company_ir_press("AZN", title2)
print("ir", len(ti or ""), ei)
