#!/usr/bin/env python3
"""Probe Access desk data + summary timing on VPS."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

STORE = Path("/opt/biotech/data/tester_feedback_store.json")


def find_token() -> str:
    for p in (
        Path("/opt/biotech/.supernova_api_token"),
        Path("/opt/biotech/data/.supernova_api_token"),
    ):
        if p.is_file():
            return p.read_text(encoding="utf-8").strip()
    for root in (Path("/etc/systemd/system"), Path("/opt/biotech/config")):
        if not root.exists():
            continue
        for f in root.rglob("*"):
            if not f.is_file():
                continue
            try:
                t = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            m = re.search(r"SUPERNOVA_API_TOKEN=(\S+)", t)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    env = os.environ.get("SUPERNOVA_API_TOKEN", "")
    if env:
        return env.strip()
    # service environment
    try:
        import subprocess

        out = subprocess.check_output(
            ["systemctl", "show", "supernova-web", "-p", "Environment", "--value"],
            text=True,
        )
        m = re.search(r"SUPERNOVA_API_TOKEN=(\S+)", out)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def get(path: str, token: str, timeout: float = 60.0) -> tuple[int, float, dict | list | str]:
    req = urllib.request.Request(
        f"http://127.0.0.1:8765{path}",
        headers={"X-SuperNova-Token": token} if token else {},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        code = e.code
    except Exception as e:
        return 0, round(time.time() - t0, 3), f"ERR {e}"
    dt = round(time.time() - t0, 3)
    try:
        return code, dt, json.loads(body.decode("utf-8"))
    except Exception:
        return code, dt, body[:200].decode("utf-8", "replace")


def main() -> None:
    d = json.loads(STORE.read_text(encoding="utf-8"))
    print("store_events", len(d.get("events") or []))
    print("store_testers", len(d.get("testers") or {}))
    for tid, meta in (d.get("testers") or {}).items():
        if isinstance(meta, dict):
            print(" ", tid, meta.get("email"), meta.get("status"), "premium=", meta.get("premium"))

    os.chdir("/opt/biotech")
    import sys

    sys.path.insert(0, "/opt/biotech")
    t0 = time.time()
    import tester_feedback_io as tf

    s = tf.build_summary()
    print(
        "build_summary_s",
        round(time.time() - t0, 3),
        "n",
        len(s.get("testers") or []),
        "approved",
        s.get("approved_testers"),
        "path",
        s.get("store_path"),
    )

    token = find_token()
    print("token_len", len(token))
    for path in (
        "/api/tester-feedback/summary",
        "/api/tester-feedback/config",
        "/api/premium-waitlist",
        "/api/contact",
    ):
        code, dt, body = get(path, token)
        if isinstance(body, dict):
            n = len(body.get("testers") or body.get("entries") or [])
            print(path, "code", code, "s", dt, "n", n, "keys", list(body.keys())[:8])
            if path.endswith("summary") and isinstance(body.get("testers"), list):
                for t in body["testers"]:
                    print(
                        "   tester",
                        t.get("tester_id") or t.get("id"),
                        t.get("email"),
                        t.get("status"),
                    )
        else:
            print(path, "code", code, "s", dt, "body", body)


if __name__ == "__main__":
    main()
