"""Hi-Tech lane notify list — email interest when High-tech desk opens (not Premium access)."""
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

NOTIFY_PATH = Path(DATA_DIR) / "hitech_notify_list.json"
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict[str, Any]:
    return {"schema_version": 1, "updated_at": None, "entries": []}


def _load() -> dict[str, Any]:
    if not NOTIFY_PATH.is_file():
        return _empty()
    try:
        raw = json.loads(NOTIFY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    if not isinstance(raw.get("entries"), list):
        raw["entries"] = []
    return raw


def _save(doc: dict[str, Any]) -> None:
    NOTIFY_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = _now_iso()
    tmp = NOTIFY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(NOTIFY_PATH)


def _normalize_email(raw: str) -> str:
    em = (raw or "").strip().lower()
    if len(em) < 6 or len(em) > 180 or not _EMAIL_RE.match(em):
        raise ValueError("valid email required")
    return em


def join_hitech_notify(email: str) -> dict[str, Any]:
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
                return {"ok": True, "already": True, "position": i}
        entries.append({"email": em, "created_at": _now_iso()})
        position = len(entries)
        _save(doc)
    _log.info("hitech notify signup: %s (#%s)", em, position)
    return {"ok": True, "already": False, "position": position}


def list_hitech_notify() -> dict[str, Any]:
    doc = _load()
    entries = doc.get("entries") if isinstance(doc.get("entries"), list) else []
    clean = [e for e in entries if isinstance(e, dict) and e.get("email")]
    # Stable # for Access tab (1-based join order).
    numbered: list[dict[str, Any]] = []
    for i, row in enumerate(clean, start=1):
        numbered.append(
            {
                "email": str(row.get("email") or "").strip().lower(),
                "created_at": row.get("created_at"),
                "position": i,
            }
        )
    return {
        "ok": True,
        "updated_at": doc.get("updated_at"),
        "count": len(numbered),
        "entries": numbered,
    }


def remove_hitech_notify(email: str) -> dict[str, Any]:
    """Access tab — dismiss one Technology/AI notify row."""
    em = _normalize_email(email)
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
            if not (
                isinstance(row, dict)
                and str(row.get("email") or "").strip().lower() == em
            )
        ]
        removed = before - len(doc["entries"])
        if removed:
            _save(doc)
    return {"ok": True, "removed": removed > 0, "email": em}
