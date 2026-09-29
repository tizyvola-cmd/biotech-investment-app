from daily_news_desk import (
    _body_matches_headline,
    _fetch_url_text,
    _guess_publisher_urls_from_title,
)

TITLE = (
    "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment "
    "- simplywall.st"
)
URL = (
    "https://news.google.com/rss/articles/"
    "CBMi1wFBVV95cUxPMzBvTnNHZ05NTXdwOEN0TTJFWXlBeldwd0tfRWpuWS1wV0ROR0F4aGsxVTgtbEEw"
    "TjFQcFJWTlVERldhQjB6ck5kLUVaUzA2MHA4Tk9HYWFXTGROMDBrTDR2T0FiM0tQbHg0dE5lRmRhVndJ"
    "cENqTWx4X3phVE5qQk1mckMtSmlYUktYVFU5Mkt0U1ZnbklIc25hVmsta3VzckRod1ItbE5SMjhoOXl6"
    "ZTRHbnRtVlZhdmZvMzVrWmZfYU9pOVNqVDJEMGhOMHlMaUVxRTVNVdIB3AFBVV95cUxPUXQ5VElURVE0"
    "YU5WaU1Pd3JULXBhTk5QaHRoNmJ0a2tDZVFxWGFOME1lS3Ytd0hubGdCYWl1aC05MzJVaENTRG1VTFJH"
    "bXJ5V2IzbENqVFVrLXQ1UGc1ek1VTVlyMTNPSWwtU1loeXljWWd2bC04RHJYVVZ"
)
print("guesses containing -alzheimer:")
for g in _guess_publisher_urls_from_title(TITLE):
    if g.endswith("-alzheimer") or "/alzheimer" in g:
        print(" ", g)
print("fetch:")
t, e = _fetch_url_text(URL, title_hint=TITLE, ticker_hint="BIIB", quick=True)
print("err", e, "len", len(t or ""), "match", _body_matches_headline(TITLE, t or ""))
print((t or "")[:300])
stale = (
    "Stoke Therapeutics and Biogen Present Long-Term Clinical Data that Support "
    "the Disease-Modifying Potential of Zorevunersen for the Treatment of Dravet Syndrome. " * 3
)
print("stale_match", _body_matches_headline(TITLE, stale))
