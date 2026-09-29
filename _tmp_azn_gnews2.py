from daily_news_desk import _fetch_url_text, _unwrap_google_news_url, _read

doc = _read()
row = next(r for r in doc.get("items") or [] if r.get("id") == "c92d164538ecade7")
title = row.get("title") or ""
url = row.get("link") or row.get("url") or ""

u_http = _unwrap_google_news_url(url, timeout_s=14.0, allow_http=True)
u_no = _unwrap_google_news_url(url, timeout_s=14.0, allow_http=False)
print("allow_http True ", (u_http or "")[:120])
print("allow_http False", (u_no or "")[:120])

t1, e1 = _fetch_url_text(url, title_hint=title, ticker_hint="AZN", quick=True)
print("quick GNews", len(t1 or ""), e1)
t2, e2 = _fetch_url_text(url, title_hint=title, ticker_hint="AZN", quick=False)
print("full GNews", len(t2 or ""), e2)
resolved = row.get("resolved_link") or u_http
t3, e3 = _fetch_url_text(resolved, title_hint=title, ticker_hint="AZN", quick=True)
print("quick resolved", len(t3 or ""), e3)
