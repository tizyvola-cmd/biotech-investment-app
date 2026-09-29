from daily_news_desk import brief_daily_news_item

r = brief_daily_news_item(
    title="FDA AdCom briefing · MID-C / ApiFix (KIDS) · Pediatric Advisory Committee",
    url="https://www.fda.gov/media/194303/download",
    ticker="KIDS",
)
b = r.get("brief") or {}
print("ok", r.get("ok"), "cached", r.get("cached"))
print("digest", b.get("digest_method"), "clin", b.get("clinical_score"))
print("sec", len(b.get("section_summaries") or []), "insight", bool(b.get("investor_insight")))
print((b.get("detail_summary") or "")[:200])
