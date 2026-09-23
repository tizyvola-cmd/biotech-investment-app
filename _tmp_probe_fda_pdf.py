"""Probe FDA PDF download with improved headers."""
import fda_adcom_calendar as fac

url = "https://www.fda.gov/media/194303/download"
try:
    raw = fac._http_get_bytes(url, timeout=40)
    print("ok", len(raw), raw[:8])
except Exception as e:
    print("fail", type(e).__name__, e)
