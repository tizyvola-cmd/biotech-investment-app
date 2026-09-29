#!/usr/bin/env python3
"""Ensure owner email has premium=True in tester store."""
from __future__ import annotations

import tester_feedback_io as tf

OWNER = "tizyvola@gmail.com"


def main() -> None:
    store = tf.load_store()
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    n = 0
    for tid, meta in list(testers.items()):
        if not isinstance(meta, dict):
            continue
        email = str(meta.get("email") or "").strip().lower()
        if email == OWNER or tf._is_allowed_owner_email(email):
            if not meta.get("premium"):
                meta["premium"] = True
                testers[tid] = meta
                n += 1
            print("owner", tid, email, "premium=", bool(meta.get("premium")))
    if n:
        store["testers"] = testers
        tf.save_store(store)
    print("updated", n)


if __name__ == "__main__":
    main()
