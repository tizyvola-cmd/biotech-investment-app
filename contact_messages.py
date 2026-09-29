"""Public Contact form messages — shown in Access tab (not Technology notify)."""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_log = logging.getLogger(__name__)

CONTACT_PATH = Path(DATA_DIR) / "contact_messages.json"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_LOCK = threading.Lock()
_MAX_MESSAGE = 4000
_MAX_NAME = 80


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict[str, Any]:
    return {"schema_version": 1, "updated_at": None, "entries": []}


def _load() -> dict[str, Any]:
    if not CONTACT_PATH.is_file():
        return _empty()
    try:
        raw = json.loads(CONTACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    if not isinstance(raw.get("entries"), list):
        raw["entries"] = []
    return raw


def _save(doc: dict[str, Any]) -> None:
    CONTACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = _now_iso()
    tmp = CONTACT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(CONTACT_PATH)


def _normalize_email(raw: str) -> str:
    em = (raw or "").strip().lower()
    if len(em) < 6 or len(em) > 180 or not _EMAIL_RE.match(em):
        raise ValueError("valid email required")
    return em


def _clean_name(raw: str, *, field: str) -> str:
    s = re.sub(r"\s+", " ", (raw or "").strip())
    if len(s) < 1 or len(s) > _MAX_NAME:
        raise ValueError(f"{field} required (1–{_MAX_NAME} chars)")
    return s


def _clean_message(raw: str) -> str:
    s = (raw or "").strip()
    if len(s) < 3:
        raise ValueError("message required (min 3 characters)")
    if len(s) > _MAX_MESSAGE:
        s = s[:_MAX_MESSAGE]
    return s


def submit_contact_message(
    *,
    email: str,
    first_name: str,
    last_name: str,
    message: str,
) -> dict[str, Any]:
    em = _normalize_email(email)
    fn = _clean_name(first_name, field="first_name")
    ln = _clean_name(last_name, field="last_name")
    msg = _clean_message(message)
    entry = {
        "id": uuid.uuid4().hex[:16],
        "email": em,
        "first_name": fn,
        "last_name": ln,
        "message": msg,
        "created_at": _now_iso(),
        "read": False,
    }
    with _LOCK:
        doc = _load()
        entries = doc.setdefault("entries", [])
        if not isinstance(entries, list):
            entries = []
            doc["entries"] = entries
        entries.insert(0, entry)
        # Cap store size
        if len(entries) > 500:
            doc["entries"] = entries[:500]
        _save(doc)
    _log.info("contact message from %s %s <%s>", fn, ln, em)
    return {"ok": True, "id": entry["id"]}


def list_contact_messages() -> dict[str, Any]:
    doc = _load()
    entries = doc.get("entries") if isinstance(doc.get("entries"), list) else []
    clean: list[dict[str, Any]] = []
    for row in entries:
        if not isinstance(row, dict) or not row.get("email"):
            continue
        clean.append(
            {
                "id": str(row.get("id") or ""),
                "email": str(row.get("email") or "").strip().lower(),
                "first_name": str(row.get("first_name") or "").strip(),
                "last_name": str(row.get("last_name") or "").strip(),
                "message": str(row.get("message") or "").strip(),
                "created_at": row.get("created_at"),
                "read": bool(row.get("read")),
            }
        )
    unread = sum(1 for r in clean if not r.get("read"))
    return {
        "ok": True,
        "updated_at": doc.get("updated_at"),
        "count": len(clean),
        "unread": unread,
        "entries": clean,
    }


def dismiss_contact_message(message_id: str) -> dict[str, Any]:
    mid = (message_id or "").strip()
    if not mid:
        raise ValueError("id required")
    with _LOCK:
        doc = _load()
        entries = doc.setdefault("entries", [])
        if not isinstance(entries, list):
            entries = []
            doc["entries"] = entries
        before = len(entries)
        doc["entries"] = [
            row
            for row in entries
            if not (isinstance(row, dict) and str(row.get("id") or "") == mid)
        ]
        removed = before - len(doc["entries"])
        if removed:
            _save(doc)
    return {"ok": True, "removed": removed > 0, "id": mid}


def mark_contact_read(message_id: str) -> dict[str, Any]:
    mid = (message_id or "").strip()
    if not mid:
        raise ValueError("id required")
    with _LOCK:
        doc = _load()
        entries = doc.setdefault("entries", [])
        if not isinstance(entries, list):
            return {"ok": False, "found": False}
        found = False
        for row in entries:
            if isinstance(row, dict) and str(row.get("id") or "") == mid:
                row["read"] = True
                found = True
                break
        if found:
            _save(doc)
    return {"ok": True, "found": found, "id": mid}
