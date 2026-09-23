from pathlib import Path
import urllib.request

for p in [
    "/opt/biotech/.env",
    "/opt/biotech/config/profiles/desktop_web_host.env",
    "/opt/biotech/config/profiles/desktop_web_host.local.env",
]:
    path = Path(p)
    if not path.exists():
        print(p, "MISSING")
        continue
    found = False
    for line in path.read_text(errors="ignore").splitlines():
        s = line.strip()
        if s.startswith("SUPERNOVA_API_TOKEN="):
            val = s.split("=", 1)[1].strip().strip('"').strip("'")
            print(p, "SET" if val else "EMPTY", "len", len(val))
            found = True
    if not found:
        print(p, "ABSENT")

checks = [
    ("GET", "/api/tester-feedback/summary"),
    ("GET", "/api/tester-feedback/events"),
    ("GET", "/api/tester-feedback/export"),
    ("GET", "/api/investment/sim-inputs"),
    ("PUT", "/api/investment/sim-inputs"),
    ("POST", "/api/tester-feedback/events"),
    ("POST", "/api/ai/secrets"),
]
for method, path in checks:
    req = urllib.request.Request(
        f"http://127.0.0.1:8765{path}",
        method=method,
        data=b"{}" if method in ("PUT", "POST") else None,
        headers={"Content-Type": "application/json"} if method in ("PUT", "POST") else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"{method} {path} -> {r.status}")
    except Exception as e:
        code = getattr(getattr(e, "code", None), "real", None) or getattr(e, "code", None)
        print(f"{method} {path} -> {code or type(e).__name__}")
