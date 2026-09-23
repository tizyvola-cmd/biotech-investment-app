from daily_news_desk import (
    _article_fingerprint,
    _body_matches_headline,
    _brief_cache_get,
    _read,
    brief_daily_news_item,
)

title = (
    "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment "
    "- simplywall.st"
)
url = (
    "https://news.google.com/rss/articles/"
    "CBMi1wFBVV95cUxPMzBvTnNHZ05NTXdwOEN0TTJFWXlBeldwd0tfRWpuWS1wV0ROR0F4aGsxVTgtbEEw"
    "TjFQcFJWTlVERldhQjB6ck5kLUVaUzA2MHA4Tk9HYWFXTGROMDBrTDR2T0FiM0tQbHg0dE5lRmRhVndJ"
    "cENqTWx4X3phVE5qQk1mckMtSmlYUktYVFU5Mkt0U1ZnbklIc25hVmsta3VzckRod1ItbE5SMjhoOXl6"
    "ZTRHbnRtVlZhdmZvMzVrWmZfYU9pOVNqVDJEMGhOMHlMaUVxRTVNVdIB3AFBVV95cUxPUXQ5VElURVE0"
    "YU5WaU1Pd3JULXBhTk5QaHRoNmJ0a2tDZVFxWGFOME1lS3Ytd0hubGdCYWl1aC05MzJVaENTRG1VTFJH"
    "bXJ5V2IzbENqVFVrLXQ1UGc1ek1VTVlyMTNPSWwtU1loeXljWWd2bC04RHJYVVZ"
)
fp = _article_fingerprint(
    ticker="BIIB", title=title, url=url, item_id="55f9891980948dd8"
)
doc = _read()
c = _brief_cache_get(fp, doc)
print("fp", fp, "cached", bool(c))
if c:
    blob = " ".join(
        [
            str(c.get("detail_summary") or ""),
            str(c.get("investor_takeaway") or ""),
            " ".join(
                str(a.get("answer") or "")
                for a in (c.get("digest_answers") or [])
                if isinstance(a, dict)
            ),
        ]
    )
    print("match", _body_matches_headline(title, blob))
    print("detail0", str(c.get("detail_summary") or "")[:160])
    # show strong hits
    from daily_news_desk import _title_token_set

    toks = _title_token_set(title)
    print("tok hits", sorted(t for t in toks if t in blob.lower())[:20])

out = brief_daily_news_item(
    title=title, url=url, ticker="BIIB", item_id="55f9891980948dd8"
)
print("ok", out.get("ok"), "cached", out.get("cached"))
print(str((out.get("brief") or {}).get("detail_summary") or "")[:220])
