#!/usr/bin/env python3
"""Publish content-addressed CDN objects (+ optional R2/S3 upload)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cdn_snapshots import publish_local_objects, upload_objects_to_s3  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--upload", action="store_true", help="Also push to R2/S3 if configured")
    args = ap.parse_args()
    doc = publish_local_objects()
    print(json.dumps({"files": len(doc.get("files") or {}), **{k: doc[k] for k in ("updated_at", "base_url", "published_new") if k in doc}}, indent=2))
    if args.upload:
        print(json.dumps(upload_objects_to_s3(doc), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
