import json
import time
import urllib.request

body = json.dumps(
    {
        "email": "probe.abort.test@example.com",
        "display_name": "Probe Abort",
        "source": "desktop",
        "first_name": "Probe",
        "last_name": "Abort",
        "birth_year": 1990,
        "interest_edition": "both",
        "interest_other": "Biotech oncology",
    }
).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8765/api/tester-feedback/testers/register",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=45) as r:
        print("status", r.status, "elapsed", round(time.time() - t0, 2))
        print(r.read()[:400].decode())
except Exception as e:
    print("ERR", type(e).__name__, e, "elapsed", round(time.time() - t0, 2))
