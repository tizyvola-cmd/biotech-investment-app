from daily_news_desk import (
    _company_domain_candidates_from_title,
    _fetch_url_text,
    brief_daily_news_item,
    _read,
)

title = (
    "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
    "EU committee recommends it. - Stock Titan"
)
print("domains", _company_domain_candidates_from_title(title))

doc = _read()
row = next(r for r in doc.get("items") or [] if r.get("id") == "c92d164538ecade7")
url = row.get("resolved_link") or row.get("link")
print("fetch target", (url or "")[:100])
t, e = _fetch_url_text(url, title_hint=title, ticker_hint="AZN", quick=False)
print("fetch", len(t or ""), e)

out = brief_daily_news_item(
    title=title,
    url=row.get("link"),
    ticker="AZN",
    summary=str(row.get("summary") or ""),
    item_id=row.get("id"),
)
b = (out or {}).get("brief") or {}
print(
    "brief",
    out.get("cached"),
    b.get("fetch_error"),
    b.get("clinical_score"),
    b.get("market_access_score"),
    b.get("digest_method"),
    len(str(b.get("detail_summary") or "")),
)
print(str(b.get("detail_summary") or "")[:500])
