#!/usr/bin/env python3
"""Trigger clinical pre-CD portfolio refresh (remote API or local)."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
except Exception:
    pass

REMOTE = os.environ.get("SUPERNOVA_REMOTE_URL", "http://91.99.15.48:8765").rstrip("/")


def _token() -> str:
    tok = os.environ.get("SUPERNOVA_API_TOKEN", "").strip()
    if tok:
        return tok
    p = ROOT / ".supernova_api_token"
    if p.is_file():
        return p.read_text(encoding="utf-8").strip()
    return ""


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def _post(url: str, token: str) -> dict:
    req = urllib.request.Request(url, method="POST", headers={"X-SuperNova-Token": token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def refresh_remote(*, force: bool = True, deep: bool = False) -> int:
    token = _token()
    if not token:
        print("SUPERNOVA_API_TOKEN mancante — impossibile POST sul remoto.", file=sys.stderr)
        return 2
    qs = f"portfolio_only=true&force={'true' if force else 'false'}&deep={'true' if deep else 'false'}"
    url = f"{REMOTE}/api/clinical-pre-cd/refresh?{qs}"
    print(f"POST {url}")
    try:
        started = _post(url, token)
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return 1
    print(json.dumps(started, indent=2))
    if not started.get("started"):
        return 1
    for i in range(180):
        st = _get(f"{REMOTE}/api/clinical-pre-cd/status")
        msg = st.get("message") or ""
        print(
            f"  [{i}] running={st.get('running')} "
            f"{st.get('processed', 0)}/{st.get('total', 0)} ai_ok={st.get('ai_ok', 0)} {msg[:80]}"
        )
        if not st.get("running") and (
            st.get("finished_at") or st.get("error") or int(st.get("total") or 0) > 0
        ):
            snap = _get(f"{REMOTE}/api/clinical-pre-cd/snapshot")
            print(
                f"Snapshot remoto: count={snap.get('count')} ai_ok={snap.get('ai_ok_count')} "
                f"updated={snap.get('updated_at')}"
            )
            return 0 if not st.get("error") else 1
        time.sleep(3)
    print("Timeout polling remoto", file=sys.stderr)
    return 1


def refresh_local(*, force: bool = True, deep: bool = False) -> int:
    from clinical_pre_cd_enrichment import run_clinical_pre_cd_refresh

    print("Refresh locale portfolio…")
    r = run_clinical_pre_cd_refresh(portfolio_only=True, force=force, deep=deep)
    print(json.dumps(r, indent=2))
    try:
        from prediction.signal_audit import build_calibration_document

        build_calibration_document(close_outcomes_first=False)
        print("signal_calibration.json ricostruito (locale)")
    except Exception as exc:
        print(f"calibration skip: {exc}")
    return 0 if not r.get("error") else 1


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true", help="forza refresh locale")
    ap.add_argument("--no-force", action="store_true")
    ap.add_argument("--deep", action="store_true")
    args = ap.parse_args()
    force = not args.no_force
    if args.local:
        return refresh_local(force=force, deep=args.deep)
    code = refresh_remote(force=force, deep=args.deep)
    if code == 2:
        print("Fallback -> refresh locale")
        return refresh_local(force=force, deep=args.deep)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
