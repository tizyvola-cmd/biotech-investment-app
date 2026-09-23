from daily_news_desk import (
    _body_matches_headline,
    _fetch_press_body_fallbacks,
    _fetch_url_text,
    _title_token_set,
    _unwrap_google_news_url,
)

title = "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment - simplywall.st"
url = (
    "https://news.google.com/rss/articles/"
    "CBMi1wFBVV95cUxPMzBvTnNHZ05NTXdwOEN0TTJFWXlBeldwd0tfRWpuWS1wV0ROR0F4aGsxVTgtbEEw"
    "TjFQcFJWTlVERldhQjB6ck5kLUVaUzA2MHA4Tk9HYWFXTGROMDBrTDR2T0FiM0tQbHg0dE5lRmRhVndJ"
    "cENqTWx4X3phVE5qQk1mckMtSmlYUktYVFU5Mkt0U1ZnbklIc25hVmsta3VzckRod1ItbE5SMjhoOXl6"
    "ZTRHbnRtVlZhdmZvMzVrWmZfYU9pOVNqVDJEMGhOMHlMaUVxRTVNVdIB3AFBVV95cUxPUXQ5VElURVE0"
    "YU5WaU1Pd3JULXBhTk5QaHRoNmJ0a2tDZVFxWGFOME1lS3Ytd0hubGdCYWl1aC05MzJVaENTRG1VTFJH"
    "bXJ5V2IzbENqVFVrLXQ1UGc1ek1VTVlyMTNPSWwtU1loeXljWWd2bC04RHJYVVZ"
)

t, e = _fetch_press_body_fallbacks("BIIB", title)
print("press err", e, "len", len(t or ""))
print("match", _body_matches_headline(title, t or ""))
toks = _title_token_set(title) - {
    "beta","bionics","medical","pharma","pharmaceuticals","therapeutics",
    "biosciences","company","shares","stock",
}
low = (t or "")[:5500].lower()
print("hits", sorted(x for x in toks if x in low))
print((t or "")[:500])
print("---")
# decode attempt googlenews style
import base64, re
from urllib.parse import unquote
token = unquote(url.split("/articles/")[1])
pad = "=" * ((4 - len(token) % 4) % 4)
raw = base64.urlsafe_b64decode(token + pad)
print("raw ascii:", "".join(chr(b) if 32 <= b < 127 else "." for b in raw))
print("urls", re.findall(rb"https?://[^\x00-\x1f\x7f-\xff\"'<>]{8,500}", raw))
