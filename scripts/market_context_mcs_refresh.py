#!/usr/bin/env python3
"""Daily refresh: MCS benchmark series + 30-day history → market_context_snapshot.json."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prediction.market_context_score import (  # noqa: E402
    build_market_context_snapshot,
    load_previous_snapshot,
    save_market_context_snapshot,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Market Context Score (MCS) snapshot refresh")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--history-days", type=int, default=30)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    previous = load_previous_snapshot()
    doc = build_market_context_snapshot(history_days=args.history_days, previous=previous)

    if args.dry_run:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
        return 0

    path = save_market_context_snapshot(doc)
    if not args.quiet:
        latest = doc.get("latest") or {}
        print(
            f"[MCS] status={doc.get('update_status')} "
            f"mcs={latest.get('mcs_global')} "
            f"stale_days={doc.get('stale_days')} -> {path}",
        )
    return 0 if doc.get("update_status") != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
