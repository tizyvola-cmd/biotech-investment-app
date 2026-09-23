from daily_news_desk import brief_daily_news_item, _fetch_url_text, _unwrap_google_news_url

title = (
    "AstraZeneca's cancer drug cut recurrence or death risk by 53%. "
    "EU committee recommends it. - Stock Titan"
)
# Truncated for fingerprint match — use full from VPS
gnews = (
    "https://news.google.com/rss/articles/"
    "CBMitwFBVV95cUxOUlVhT25peEhwVDU2U0tjNUdKdHo2YjVrdERQOS1JQkQ1bkV3Z3JjZEJzMTJtUWFqN1dzTUtoa3FoQlJ3UTBseHQ4MmpyOWJLMXJUNzZ5Vjk0NFR5bTZLcy04T1J3REFLWVNhUjhXSHl2NklfNFVXdmM2OFcyWGVucVFOOGJmcHpQMjNYSWZfcnlKRDlZSFBJVXhONHZYdURzWHdZek5aUjJCNXYyc182X08tZzdlZm8?oc=5"
)

print("unwrap", _unwrap_google_news_url(gnews, timeout_s=14.0, allow_http=True)[:120])
t, e = _fetch_url_text(gnews, title_hint=title, ticker_hint="AZN", quick=True)
print("fetch quick len", len(t or ""), "err", e)
print("head", repr((t or "")[:240]))

out = brief_daily_news_item(
    title=title,
    url=gnews,
    ticker="AZN",
    summary="",
    item_id="c92d164538ecade7",
)
brief = (out or {}).get("brief") or {}
print("ok", out.get("ok"), "cached", out.get("cached"))
print("fetch_error", brief.get("fetch_error"))
print("clin", brief.get("clinical_score"), "access", brief.get("market_access_score"))
print("detail_len", len(str(brief.get("detail_summary") or "")))
print("detail", str(brief.get("detail_summary") or "")[:500])
print("method", brief.get("digest_method"))
