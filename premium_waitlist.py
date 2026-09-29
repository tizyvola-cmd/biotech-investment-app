"""Premium beta waitlist — landing page email list (first 1,000 get a free year)."""
from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_log = logging.getLogger(__name__)

WAITLIST_PATH = Path(DATA_DIR) / "premium_beta_waitlist.json"
FOUNDING_CAP = 1000
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict[str, Any]:
    return {"schema_version": 1, "updated_at": None, "entries": []}


def _load() -> dict[str, Any]:
    if not WAITLIST_PATH.is_file():
        return _empty()
    try:
        raw = json.loads(WAITLIST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    entries = raw.get("entries")
    if not isinstance(entries, list):
        raw["entries"] = []
    return raw


def _save(doc: dict[str, Any]) -> None:
    WAITLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = _now_iso()
    tmp = WAITLIST_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(WAITLIST_PATH)


def _normalize_email(raw: str) -> str:
    em = (raw or "").strip().lower()
    if len(em) < 6 or len(em) > 180 or not _EMAIL_RE.match(em):
        raise ValueError("valid email required")
    return em


def join_premium_waitlist(email: str) -> dict[str, Any]:
    em = _normalize_email(email)
    with _LOCK:
        doc = _load()
        entries = doc.setdefault("entries", [])
        if not isinstance(entries, list):
            entries = []
            doc["entries"] = entries
        for i, row in enumerate(entries, start=1):
            if not isinstance(row, dict):
                continue
            if str(row.get("email") or "").strip().lower() == em:
                return {
                    "ok": True,
                    "already": True,
                    "position": i,
                    "founding_free_year": i <= FOUNDING_CAP,
                    "founding_cap": FOUNDING_CAP,
                }
        entries.append({"email": em, "created_at": _now_iso()})
        position = len(entries)
        _save(doc)

    try:
        from tester_approval_email import send_premium_waitlist_to_owner

        notify = send_premium_waitlist_to_owner(email=em, position=position)
        owner_ok = bool(notify.ok)
    except Exception as exc:
        _log.warning("premium waitlist owner notify failed: %s", exc)
        owner_ok = False

    return {
        "ok": True,
        "already": False,
        "position": position,
        "founding_free_year": position <= FOUNDING_CAP,
        "founding_cap": FOUNDING_CAP,
        "owner_notify_ok": owner_ok,
    }


def remove_premium_waitlist_email(email: str) -> dict[str, Any]:
    """Drop one waitlist row after grant / dismiss (Access tab)."""
    em = _normalize_email(email)
    with _LOCK:
        doc = _load()
        entries = doc.get("entries") if isinstance(doc.get("entries"), list) else []
        kept: list[Any] = []
        removed = False
        for row in entries:
            if not isinstance(row, dict):
                continue
            if str(row.get("email") or "").strip().lower() == em:
                removed = True
                continue
            kept.append(row)
        if removed:
            doc["entries"] = kept
            _save(doc)
        return {"ok": True, "removed": removed, "email": em, "remaining": len(kept)}


def list_premium_waitlist() -> dict[str, Any]:
    """Owner Access tab — everyone who asked for Premium."""
    with _LOCK:
        doc = _load()
        entries = doc.get("entries") if isinstance(doc.get("entries"), list) else []
        rows: list[dict[str, Any]] = []
        for i, row in enumerate(entries, start=1):
            if not isinstance(row, dict):
                continue
            em = str(row.get("email") or "").strip().lower()
            if not em:
                continue
            rows.append(
                {
                    "email": em,
                    "created_at": row.get("created_at"),
                    "position": i,
                }
            )

    # Enrich with Basic membership / premium flags for Access actions.
    try:
        import tester_feedback_io as tf

        store = tf.load_store()
        testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
        by_email: dict[str, dict[str, Any]] = {}
        for tid, meta in testers.items():
            if not isinstance(meta, dict):
                continue
            em = str(meta.get("email") or "").strip().lower()
            if not em:
                continue
            by_email[em] = {
                "tester_id": tid,
                "status": tf._resolve_status(meta),
                "premium": tf.tester_has_premium(meta),
                "display_name": meta.get("display_name") or tid,
            }
        for row in rows:
            info = by_email.get(str(row["email"]))
            if info:
                row.update(info)
            else:
                row["tester_id"] = None
                row["status"] = None
                row["premium"] = False
                row["display_name"] = None
    except Exception as exc:
        _log.warning("premium waitlist enrich failed: %s", exc)

    return {
        "ok": True,
        "updated_at": doc.get("updated_at"),
        "count": len(rows),
        "entries": rows,
    }
