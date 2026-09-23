#!/usr/bin/env python3
"""Verify CDN manifest URLs resolve on the public R2 development URL."""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

MANIFEST = Path("/opt/biotech/data/cdn_manifest.json")


def main() -> None:
    d = json.loads(MANIFEST.read_text(encoding="utf-8"))
    base = d.get("base_url")
    files = d.get("files") or {}
    print("base_url", base)
    print("file_count", len(files))
    ok = 0
    fail = 0
    for name, meta in list(files.items())[:5]:
        url = (meta or {}).get("url") or ""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                code = resp.status
                size = len(resp.read(64))
            print(f"OK {code} {name} bytes_peek={size} url={url}")
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {name} url={url} err={exc}")
            fail += 1
    print(f"summary ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
