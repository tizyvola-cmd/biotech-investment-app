import re
import requests
from daily_news_desk import _HTTP_HEADERS

article_id = (
    "CBMi1wFBVV95cUxPMzBvTnNHZ05NTXdwOEN0TTJFWXlBeldwd0tfRWpuWS1wV0ROR0F4aGsxVTgtbEEw"
    "TjFQcFJWTlVERldhQjB6ck5kLUVaUzA2MHA4Tk9HYWFXTGROMDBrTDR2T0FiM0tQbHg0dE5lRmRhVndJ"
    "cENqTWx4X3phVE5qQk1mckMtSmlYUktYVFU5Mkt0U1ZnbklIc25hVmsta3VzckRod1ItbE5SMjhoOXl6"
    "ZTRHbnRtVlZhdmZvMzVrWmZfYU9pOVNqVDJEMGhOMHlMaUVxRTVNVdIB3AFBVV95cUxPUXQ5VElURVE0"
    "YU5WaU1Pd3JULXBhTk5QaHRoNmJ0a2tDZVFxWGFOME1lS3Ytd0hubGdCYWl1aC05MzJVaENTRG1VTFJH"
    "bXJ5V2IzbENqVFVrLXQ1UGc1ek1VTVlyMTNPSWwtU1loeXljWWd2bC04RHJYVVZ"
)

cookies_list = [
    {"CONSENT": "YES+"},
    {"CONSENT": "YES+cb.20240101-01-p0.en+F+911"},
    {"SOCS": "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"},
    {"CONSENT": "YES+", "SOCS": "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"},
]
for cookies in cookies_list:
    u = f"https://news.google.com/articles/{article_id}"
    r = requests.get(u, timeout=15, headers=_HTTP_HEADERS, cookies=cookies, allow_redirects=True)
    print("cookies", cookies, "final", r.url[:60], "sg", bool(re.search(r"data-n-a-sg=", r.text)), "len", len(r.text))
