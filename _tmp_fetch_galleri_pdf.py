"""Fetch Galleri FDA briefing PDF / meeting page (run on VPS or local)."""
from __future__ import annotations

import re
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 (compatible; SuperNova/1.0)"}


def get(url: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def main() -> int:
    pdf_url = "https://www.fda.gov/media/194909/download"
    page_url = (
        "https://www.fda.gov/advisory-committees/advisory-committee-calendar/"
        "september-23-2026-molecular-and-clinical-genetics-panel-medical-devices-"
        "advisory-committee-meeting"
    )
    out = Path("/tmp/galleri_194909.pdf")
    try:
        data = get(pdf_url)
        out.write_bytes(data)
        print("pdf ok", len(data), out)
    except Exception as e:
        print("pdf ERR", type(e).__name__, e)
    try:
        html = get(page_url).decode("utf-8", "replace")
        links = sorted(
            set(
                re.findall(r"https?://www\.fda\.gov/media/\d+/download", html)
                + re.findall(r"/media/\d+/download", html)
            )
        )
        print("media", links)
        print("galleri", "galleri" in html.lower())
        print("html_len", len(html))
    except Exception as e:
        print("page ERR", type(e).__name__, e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
