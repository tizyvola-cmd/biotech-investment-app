"""
CDN / edge-cache helpers for shared snapshot JSON.

Phase 1 (no Cloudflare account required yet):
  * Correct Cache-Control on ``/project-data`` and ``/cdn/o`` so an edge proxy
    can cache shared snapshots.
  * Content-addressed copies under ``data/cdn/objects/{sha256}.json`` plus
    ``data/cdn_manifest.json`` (logical name → hash + bytes + mtime).

Phase 2 (optional): upload objects to S3-compatible storage (Cloudflare R2)
when ``SUPERNOVA_CDN_S3_*`` env vars are set.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_log = logging.getLogger(__name__)

CDN_DIR = Path(DATA_DIR) / "cdn"
OBJECTS_DIR = CDN_DIR / "objects"
MANIFEST_PATH = Path(DATA_DIR) / "cdn_manifest.json"

# Shared, cacheable snapshots (never per-user books / secrets).
_SNAPSHOT_RE = re.compile(
    r"(?:^|.*/)(?:"
    r".*_snapshot\.json|"
    r"desktop_data_manifest\.json|"
    r"cdn_manifest\.json|"
    r"market_context(?:_snapshot)?\.json|"
    r"eis_super_score_learning\.json|"
    r"catalyst_sim_entries\.json|"
    r"catalyst_interest_watchlist\.json"
    r")$",
    re.IGNORECASE,
)

# Never cache at the edge — and never serve via public /project-data/.
_PRIVATE_RE = re.compile(
    r"(?:^|.*/)(?:"
    r"tester_|"
    r"invest_sim_inputs\.json|"
    r"invest_sim_history\.json|"
    r"desktop_ui_prefs\.json|"
    r"ai_secrets|"
    r".*secret|"
    r".*credential|"
    r"manual_feed|"
    r".*\.env|"
    r".*\.pem|"
    r".*\.key$"
    r")",
    re.IGNORECASE,
)

# Logical names published into the hashed object store.
DEFAULT_PUBLISH_GLOBS = (
    "*_snapshot.json",
    "desktop_data_manifest.json",
    "market_context.json",
    "market_context_snapshot.json",
    "eis_super_score_learning.json",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_private_project_path(rel_path: str) -> bool:
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    return bool(_PRIVATE_RE.search(rel))


def is_cacheable_snapshot(rel_path: str) -> bool:
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    if is_private_project_path(rel):
        return False
    return bool(_SNAPSHOT_RE.search(rel))


def is_public_project_data_path(rel_path: str) -> bool:
    """
    Allowlist for unauthenticated ``GET /project-data/{path}``.

    Default deny: only shared snapshot / manifest JSON. Secrets, tester books,
    and sim-input portfolios must never be reachable without an API token.
    """
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        return False
    # No nested escapes / absolute-looking segments.
    if rel.startswith("/") or "\\" in rel:
        return False
    name = rel.rsplit("/", 1)[-1]
    if not name.lower().endswith(".json"):
        return False
    return is_cacheable_snapshot(rel)


def cache_control_for_project_path(rel_path: str) -> str:
    """
    Headers for origin responses that Cloudflare/nginx can honor.

    Manifest: short TTL + SWR. Snapshots: 60s + SWR (safe until names are hashed).
    Private: no-store.
    """
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    if is_private_project_path(rel):
        return "private, no-store"
    name = rel.rsplit("/", 1)[-1].lower()
    if name in ("desktop_data_manifest.json", "cdn_manifest.json"):
        return "public, max-age=30, stale-while-revalidate=60"
    if is_cacheable_snapshot(rel):
        return "public, max-age=60, stale-while-revalidate=300"
    return "private, no-store"


def cache_control_for_cdn_object() -> str:
    return "public, max-age=31536000, immutable"


def cdn_public_base() -> str:
    """Public URL prefix for hashed objects (R2 custom domain or same-origin /cdn/o)."""
    raw = (
        os.environ.get("SUPERNOVA_CDN_BASE_URL", "").strip()
        or os.environ.get("VITE_CDN_BASE", "").strip()
    )
    if raw:
        return raw.rstrip("/") + "/"
    return "/cdn/o/"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        return {"version": 1, "updated_at": None, "base_url": cdn_public_base(), "files": {}}
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("cdn manifest load failed: %s", exc)
        return {"version": 1, "updated_at": None, "base_url": cdn_public_base(), "files": {}}
    if not isinstance(data, dict):
        return {"version": 1, "updated_at": None, "base_url": cdn_public_base(), "files": {}}
    data.setdefault("version", 1)
    data.setdefault("files", {})
    data["base_url"] = cdn_public_base()
    return data


def publish_local_objects(
    *,
    data_dir: Path | None = None,
    globs: tuple[str, ...] = DEFAULT_PUBLISH_GLOBS,
) -> dict[str, Any]:
    """
    Copy matching ``data/*.json`` into content-addressed objects and rewrite manifest.
    """
    root = Path(data_dir or DATA_DIR)
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
    files: dict[str, Any] = {}
    published = 0
    for pattern in globs:
        for path in sorted(root.glob(pattern)):
            if not path.is_file() or path.suffix.lower() != ".json":
                continue
            if path.name in ("cdn_manifest.json",) or path.parent == OBJECTS_DIR:
                continue
            if is_private_project_path(path.name):
                continue
            digest = sha256_file(path)
            dest = OBJECTS_DIR / f"{digest}.json"
            if not dest.is_file():
                dest.write_bytes(path.read_bytes())
                published += 1
            rel = path.name
            st = path.stat()
            files[rel] = {
                "sha256": digest,
                "bytes": st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                "url": f"{cdn_public_base()}{digest}.json",
            }
    doc = {
        "version": 1,
        "updated_at": _now_iso(),
        "base_url": cdn_public_base(),
        "files": files,
        "published_new": published,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(MANIFEST_PATH)
    _log.info("CDN manifest: %s files (%s new objects)", len(files), published)
    return doc


def resolve_cdn_object(sha: str) -> Path | None:
    digest = re.sub(r"[^a-f0-9]", "", (sha or "").lower())
    if len(digest) != 64:
        return None
    path = OBJECTS_DIR / f"{digest}.json"
    return path if path.is_file() else None


def upload_objects_to_s3(manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Optional R2/S3 upload. Requires::

        SUPERNOVA_CDN_S3_ENDPOINT
        SUPERNOVA_CDN_S3_BUCKET
        SUPERNOVA_CDN_S3_ACCESS_KEY
        SUPERNOVA_CDN_S3_SECRET_KEY
        SUPERNOVA_CDN_S3_PREFIX (optional, default ``o/``)
    """
    endpoint = os.environ.get("SUPERNOVA_CDN_S3_ENDPOINT", "").strip()
    bucket = os.environ.get("SUPERNOVA_CDN_S3_BUCKET", "").strip()
    access = os.environ.get("SUPERNOVA_CDN_S3_ACCESS_KEY", "").strip()
    secret = os.environ.get("SUPERNOVA_CDN_S3_SECRET_KEY", "").strip()
    prefix = os.environ.get("SUPERNOVA_CDN_S3_PREFIX", "o/").strip() or "o/"
    if not prefix.endswith("/"):
        prefix += "/"
    if not all((endpoint, bucket, access, secret)):
        return {"ok": False, "skipped": True, "reason": "S3 env not configured"}
    try:
        import boto3
        from botocore.client import Config
    except ImportError:
        return {"ok": False, "error": "boto3 not installed"}

    doc = manifest or load_manifest()
    files = doc.get("files") if isinstance(doc.get("files"), dict) else {}
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4"),
        region_name=os.environ.get("SUPERNOVA_CDN_S3_REGION", "auto").strip() or "auto",
    )
    uploaded = 0
    for meta in files.values():
        if not isinstance(meta, dict):
            continue
        digest = str(meta.get("sha256") or "")
        path = resolve_cdn_object(digest)
        if path is None:
            continue
        key = f"{prefix}{digest}.json"
        client.upload_file(
            str(path),
            bucket,
            key,
            ExtraArgs={
                "ContentType": "application/json; charset=utf-8",
                "CacheControl": cache_control_for_cdn_object(),
            },
        )
        uploaded += 1
    # Also upload the manifest itself (short cache — caller sets CDN rules).
    if MANIFEST_PATH.is_file():
        client.upload_file(
            str(MANIFEST_PATH),
            bucket,
            f"{prefix}manifest.json",
            ExtraArgs={
                "ContentType": "application/json; charset=utf-8",
                "CacheControl": "public, max-age=30, stale-while-revalidate=60",
            },
        )
    return {"ok": True, "uploaded": uploaded, "bucket": bucket, "prefix": prefix}
