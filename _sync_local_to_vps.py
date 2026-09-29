"""One-shot: merge approved testers from LOCAL store into VPS store.

The desktop UI you clicked "Send invite" from was talking to the LOCAL
backend (127.0.0.1:8765) whose store is `data/tester_feedback_store.json`.
The invite emails contained the VPS mobile URL, so testers landed on the
VPS mobile which has a *different* store — they saw pending.

This script:
  1. Reads local approved testers (source=desktop).
  2. SSHes into the VPS, reads its store, and merges those approved
     testers in (overwriting any pending record with the same id).
  3. Writes the merged store back on the VPS, keeping every session-ping
     event / other tester intact.
  4. Restarts supernova-web so the change takes effect immediately.

Idempotent: re-running won't duplicate anything.
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

LOCAL_STORE = Path("data/tester_feedback_store.json")
VPS_STORE_REMOTE = "/opt/biotech/data/tester_feedback_store.json"
SSH_HOST = "root@91.99.15.48"


def run(cmd: list[str]) -> str:
    res = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return res.stdout


def fetch_remote_store() -> dict:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
    tmp.close()
    run(["scp", f"{SSH_HOST}:{VPS_STORE_REMOTE}", tmp.name])
    with io.open(tmp.name, encoding="utf-8-sig") as fh:
        return json.load(fh)


def push_remote_store(data: dict) -> None:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="w", encoding="utf-8")
    json.dump(data, tmp, ensure_ascii=False, indent=2)
    tmp.close()
    run(["scp", tmp.name, f"{SSH_HOST}:{VPS_STORE_REMOTE}"])


def main() -> int:
    if not LOCAL_STORE.is_file():
        print(f"Local store not found: {LOCAL_STORE}", file=sys.stderr)
        return 1

    with io.open(LOCAL_STORE, encoding="utf-8-sig") as fh:
        local = json.load(fh)
    local_testers = local.get("testers", {})

    approved_desktop = {
        tid: meta
        for tid, meta in local_testers.items()
        if isinstance(meta, dict)
        and meta.get("status") == "approved"
        and meta.get("source") == "desktop"
    }
    print(f"Local approved (desktop-invited) testers: {len(approved_desktop)}")
    for tid, meta in approved_desktop.items():
        print(f"  - {tid} ({meta.get('email')}) name={meta.get('display_name')}")

    if not approved_desktop:
        print("Nothing to sync.")
        return 0

    print("\nFetching remote store from VPS...")
    remote = fetch_remote_store()
    remote_testers = remote.get("testers", {})
    print(f"Remote testers before merge: {len(remote_testers)}")

    changes = 0
    for tid, local_meta in approved_desktop.items():
        prev = remote_testers.get(tid) if isinstance(remote_testers.get(tid), dict) else None
        merged = dict(local_meta)
        if prev:
            merged["last_seen_at"] = prev.get("last_seen_at") or merged.get("last_seen_at")
            merged["event_count"] = int(prev.get("event_count") or 0)
            merged["session_ping_count"] = int(prev.get("session_ping_count") or 0)
            if prev.get("status") != "approved":
                print(f"  [flip] {tid}: {prev.get('status')} -> approved")
            else:
                print(f"  [update] {tid}")
        else:
            print(f"  [new]    {tid}")
        remote_testers[tid] = merged
        changes += 1

    remote["testers"] = remote_testers
    from datetime import datetime, timezone
    remote["updated_at"] = datetime.now(timezone.utc).isoformat()

    print(f"\nPushing merged store back ({changes} changes)...")
    push_remote_store(remote)

    print("Restarting supernova-web on VPS...")
    subprocess.run(
        ["ssh", SSH_HOST, "systemctl restart supernova-web && sleep 2 && systemctl is-active supernova-web"],
        check=True,
    )
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
