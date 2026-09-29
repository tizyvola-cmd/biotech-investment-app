from daily_news_desk import brief_daily_news_item

url = (
    "https://www.stocktitan.net/news/AZN/"
    "enhertu-recommended-for-approval-in-the-eu-by-chmp-as-adjuvant-2bk6b3ujpk53.html"
)
title = (
    "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
    "EU committee recommends it."
)

out = brief_daily_news_item(
    title=title,
    url=url,
    ticker="AZN",
    summary="CHMP backs Enhertu for high-risk HER2 positive early breast cancer.",
    item_id="diag-azn-enhertu-chmp",
)
brief = (out or {}).get("brief") or {}
print("ok", (out or {}).get("ok"), "cached", (out or {}).get("cached"))
print("fetch_error", brief.get("fetch_error"))
print("schema", brief.get("brief_schema"))
print("method", brief.get("digest_method"))
print("clin", brief.get("clinical_score"), "fin", brief.get("financial_score"), "access", brief.get("market_access_score"))
print("detail_len", len(str(brief.get("detail_summary") or "")))
print("detail", str(brief.get("detail_summary") or "")[:700])
print("sections", [(s.get("title"), str(s.get("summary") or "")[:120]) for s in (brief.get("section_summaries") or [])[:4]])
print("event", ((brief.get("taxonomy_dimensions") or {}).get("clinical") or {}).get("event_id"))
