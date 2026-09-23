#!/usr/bin/env python3
"""
Publish hashed CDN objects locally and optionally upload to Cloudflare R2 / S3.

Called after snapshot refreshes. Safe to run when R2 env is unset (local only).

Env (optional R2)::

    SUPERNOVA_CDN_S3_ENDPOINT=https://ACCOUNTID.r2.cloudflarestorage.com
    SUPERNOVA_CDN_S3_BUCKET=supernova-snapshots
    SUPERNOVA_CDN_S3_ACCESS_KEY=...
    SUPERNOVA_CDN_S3_SECRET_KEY=...
    SUPERNOVA_CDN_BASE_URL=https://cdn.supernovalpha.com/o
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from cdn_snapshots import publish_local_objects, upload_objects_to_s3  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_log = logging.getLogger("cdn_publish")


def main() -> int:
    doc = publish_local_objects()
    s3 = upload_objects_to_s3(doc)
    out = {
        "ok": True,
        "files": len(doc.get("files") or {}),
        "published_new": doc.get("published_new"),
        "base_url": doc.get("base_url"),
        "s3": s3,
    }
    print(json.dumps(out, indent=2))
    if s3.get("skipped"):
        _log.info("R2/S3 skipped (env not set) — local CDN objects ready")
    elif not s3.get("ok"):
        _log.warning("R2/S3 upload issue: %s", s3)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
