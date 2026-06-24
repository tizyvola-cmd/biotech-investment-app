#!/usr/bin/env python3
"""Run Learning Lab cycle (cluster CF + regime multipliers). Default: dry-run preview."""
from __future__ import annotations

import argparse
import json
import sys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Learning Lab — cluster CF + regime multipliers")
    ap.add_argument("--apply", action="store_true", help="Write results to data/*.json (default: preview only)")
    args = ap.parse_args(argv)

    from prediction.learning_lab import run_learning_cycle

    result = run_learning_cycle(dry_run=not args.apply)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
