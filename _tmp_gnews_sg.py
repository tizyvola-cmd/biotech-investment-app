import re
import requests
from daily_news_desk import _HTTP_HEADERS, _decode_google_news_batchexecute

article_id = (
    "CBMi1wFBVV95cUxPMzBvTnNHZ05NTXdwOEN0TTJFWXlBeldwd0tfRWpuWS1wV0ROR0F4aGsxVTgtbEEw"
    "TjFQcFJWTlVERldhQjB6ck5kLUVaUzA2MHA4Tk9HYWFXTGROMDBrTDR2T0FiM0tQbHg0dE5lRmRhVndJ"
    "cENqTWx4X3phVE5qQk1mckMtSmlYUktYVFU5Mkt0U1ZnbklIc25hVmsta3VzckRod1ItbE5SMjhoOXl6"
    "ZTRHbnRtVlZhdmZvMzVrWmZfYU9pOVNqVDJEMGhOMHlMaUVxRTVNVdIB3AFBVV95cUxPUXQ5VElURVE0"
    "YU5WaU1Pd3JULXBhTk5QaHRoNmJ0a2tDZVFxWGFOME1lS3Ytd0hubGdCYWl1aC05MzJVaENTRG1VTFJH"
    "bXJ5V2IzbENqVFVrLXQ1UGc1ek1VTVlyMTNPSWwtU1loeXljWWd2bC04RHJYVVZ"
)
url = f"https://news.google.com/rss/articles/{article_id}"
for prefix in ("articles", "rss/articles"):
    u = f"https://news.google.com/{prefix}/{article_id}"
    r = requests.get(u, timeout=15, headers=_HTTP_HEADERS, allow_redirects=True)
    print(prefix, "status", r.status_code, "final", r.url[:80], "len", len(r.text))
    print(" sg", bool(re.search(r"data-n-a-sg=", r.text)), "ts", bool(re.search(r"data-n-a-ts=", r.text)))
    print(" sorry", "/sorry/" in r.url or "captcha" in r.text.lower()[:500])
    # show a snippet around n-a
    m = re.search(r".{0,40}data-n-a[^>]{0,80}", r.text)
    print(" hit", m.group(0) if m else None)

print("decode", _decode_google_news_batchexecute(url, timeout_s=14))
