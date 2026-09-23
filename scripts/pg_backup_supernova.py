#!/usr/bin/env python3
"""Dump Postgres to data/backups/ (custom format). Safe to cron daily."""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    env_files = [
        root / "config" / "profiles" / "desktop_web_host.env",
        root / ".env",
    ]
    for env_path in env_files:
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    url = (
        os.environ.get("SUPERNOVA_DATABASE_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
    )
    if not url:
        print("ERROR: SUPERNOVA_DATABASE_URL not set", file=sys.stderr)
        return 2

    out_dir = root / "data" / "backups"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_dir / f"supernova_{stamp}.dump"

    cmd = ["pg_dump", "--dbname", url, "-Fc", "-f", str(out)]
    print("Running: pg_dump -Fc ->", out.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout, file=sys.stderr)
        return proc.returncode
    print("OK", out, "bytes", out.stat().st_size)

    # Keep last 14 dumps
    dumps = sorted(out_dir.glob("supernova_*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in dumps[14:]:
        try:
            old.unlink()
            print("pruned", old.name)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
