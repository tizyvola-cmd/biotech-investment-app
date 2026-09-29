"""Probe VPS web index vs local dist-web-vps for Alessandro offline/freeze fixes."""
from __future__ import annotations

import re
import ssl
import urllib.request
from pathlib import Path

MARKERS = [
    "UI freeze on entry",
    "Catalyst desk boot stuck",
    "Something went wrong on this panel",
    "showApiOffline",
    "failsBeforeOffline",
    "boot stuck after",
    "insider/accum",
    "hourly columns",
    "Loading...",
    "Prossimi",
    "API offline",
    "probeApiReachable",
    "catalyst-desk-cache",
    "guidance-calendar/snapshot",
    "entry_freeze",
]

VPS = "http://91.99.15.48:8765"
ctx = ssl.create_default_context()


def fetch(url: str, timeout: float = 20) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "supernova-audit/1.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.status, r.read().decode("utf-8", "ignore")


def main() -> None:
    print("=== VPS index ===")
    try:
        status, html = fetch(f"{VPS}/")
        print("status", status)
        assets = re.findall(r'src="(/assets/[^"]+)"', html)
        print("assets", assets)
        print(html[:300].replace("\n", " "))
    except Exception as e:
        print("FAIL index", type(e).__name__, e)
        return

    for asset in assets:
        url = f"{VPS}{asset}"
        print(f"\n=== fetch {asset} ===")
        try:
            status, body = fetch(url, timeout=60)
            print("status", status, "bytes", len(body))
            hits = [m for m in MARKERS if m in body]
            print("hits", hits)
            missing = [m for m in MARKERS if m not in body]
            print("missing_sample", missing[:8])
        except Exception as e:
            print("FAIL asset", type(e).__name__, e)

    local = Path(__file__).resolve().parent / "desktop-ui" / "dist-web-vps" / "assets" / "index-CS4nE0mI.js"
    if local.exists():
        print("\n=== local dist-web-vps index ===")
        body = local.read_text(encoding="utf-8", errors="ignore")
        print("bytes", len(body), "hits", [m for m in MARKERS if m in body])


if __name__ == "__main__":
    main()
