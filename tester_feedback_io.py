"""
Store centralizzato per feedback tester (app mobile / PWA companion).

File: ``data/tester_feedback_store.json`` — condiviso tra API desktop e client mobile.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import TESTER_FEEDBACK_CALIB_JSON, TESTER_FEEDBACK_STORE_JSON

_log = logging.getLogger(__name__)

SCHEMA_VERSION = 2
STORE_PATH = Path(TESTER_FEEDBACK_STORE_JSON)
CALIB_PATH = Path(TESTER_FEEDBACK_CALIB_JSON)

VALID_MODULES = frozenset({"dashboard", "simulation", "decisionLab", "catalystFeed", "portfolio", "opportunities"})
VALID_KINDS = frozenset({
    "session_ping",
    "prediction_outcome",
    "slope_error",
    "signal_feedback",
    "catalyst_label",
    "gain_note",
})
VALID_SOURCES = frozenset({"mobile", "desktop", "api"})
VALID_STATUSES = frozenset({"pending", "approved", "revoked"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_store() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": None,
        "testers": {},
        "events": [],
    }


def load_store() -> dict[str, Any]:
    if not STORE_PATH.is_file():
        return _empty_store()
    try:
        with STORE_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("tester_feedback load failed: %s", exc)
        return _empty_store()
    if not isinstance(data, dict):
        return _empty_store()
    if not isinstance(data.get("testers"), dict):
        data["testers"] = {}
    if not isinstance(data.get("events"), list):
        data["events"] = []
    data.setdefault("schema_version", SCHEMA_VERSION)
    return data


def save_store(data: dict[str, Any]) -> str:
    data = dict(data)
    data["schema_version"] = SCHEMA_VERSION
    data["updated_at"] = _now_iso()
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE_PATH)
    return data["updated_at"]


def _clean_tester_id(raw: str) -> str:
    s = (raw or "").strip()[:64]
    if not s:
        raise ValueError("tester_id obbligatorio")
    return s


def _normalize_email(raw: str | None) -> str:
    e = (raw or "").strip().lower()
    if not e or "@" not in e or len(e) > 120:
        raise ValueError("email non valida")
    local, _, domain = e.partition("@")
    if not local or not domain or "." not in domain:
        raise ValueError("email non valida")
    return e


def _tester_id_from_email(email: str) -> str:
    e = _normalize_email(email)
    tid = re.sub(r"[^a-z0-9._+-]", "_", e.replace("@", "_at_"))[:64]
    return tid or "tester"


def _load_invite_codes() -> frozenset[str]:
    raw = os.environ.get("SUPERNOVA_TESTER_INVITE_CODES", "").strip()
    if not raw:
        return frozenset()
    return frozenset(c.strip() for c in raw.split(",") if c.strip())


def _resolve_status(meta: dict[str, Any]) -> str:
    s = str(meta.get("status") or "").strip().lower()
    if s in VALID_STATUSES:
        return s
    src = str(meta.get("source") or "mobile").strip().lower()
    if src == "desktop":
        return "approved"
    return "pending"


def _ensure_tester_access(tid: str, source: str) -> None:
    store = load_store()
    meta = store.get("testers", {}).get(tid)
    if not isinstance(meta, dict):
        raise ValueError("tester non registrato")
    status = _resolve_status(meta)
    if source == "desktop":
        return
    if status == "revoked":
        raise ValueError("accesso revocato — contatta l'amministratore")
    if status != "approved":
        raise ValueError("accesso in attesa di approvazione")


def register_tester(
    tester_id: str,
    *,
    display_name: str | None = None,
    invite_code: str | None = None,
    email: str | None = None,
    source: str = "mobile",
) -> dict[str, Any]:
    src = (source or "mobile").strip()
    if src not in VALID_SOURCES:
        src = "mobile"

    tid = _clean_tester_id(tester_id) if (tester_id or "").strip() else ""
    norm_email: str | None = None
    if email:
        norm_email = _normalize_email(email)
        if not tid:
            tid = _tester_id_from_email(norm_email)
    if not tid:
        raise ValueError("tester_id o email obbligatori")

    codes = _load_invite_codes()
    code = (invite_code or "").strip()
    if src == "mobile" and norm_email and codes and code not in codes:
        raise ValueError("codice invito non valido")

    store = load_store()
    testers: dict[str, Any] = store["testers"]
    now = _now_iso()
    prev = testers.get(tid) if isinstance(testers.get(tid), dict) else {}
    is_new = not prev

    if is_new:
        # Solo smoke test desktop auto-approvati; mobile sempre in attesa admin.
        status = "approved" if src == "desktop" else "pending"
    else:
        status = _resolve_status(prev)

    prev_email = str(prev.get("email") or "").strip().lower()
    if norm_email and prev_email and prev_email != norm_email:
        raise ValueError("email già associata a un altro profilo tester")

    testers[tid] = {
        "tester_id": tid,
        "display_name": (display_name or prev.get("display_name") or norm_email or tid).strip()[:80],
        "email": norm_email or prev.get("email") or "",
        "invite_code": (code or prev.get("invite_code") or "").strip()[:32],
        "status": status,
        "source": prev.get("source") or src,
        "created_at": prev.get("created_at") or now,
        "last_seen_at": now,
        "event_count": int(prev.get("event_count") or 0),
        "session_ping_count": int(prev.get("session_ping_count") or 0),
    }
    store["testers"] = testers
    save_store(store)
    meta = dict(testers[tid])
    meta["allowed"] = status == "approved"
    return meta


def get_tester_access(tester_id: str) -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    store = load_store()
    meta = store.get("testers", {}).get(tid)
    if not isinstance(meta, dict):
        return {
            "tester_id": tid,
            "registered": False,
            "status": "unknown",
            "allowed": False,
        }
    status = _resolve_status(meta)
    return {
        "tester_id": tid,
        "registered": True,
        "display_name": meta.get("display_name") or tid,
        "email": meta.get("email") or "",
        "status": status,
        "allowed": status == "approved",
        "created_at": meta.get("created_at"),
        "last_seen_at": meta.get("last_seen_at"),
        "event_count": int(meta.get("event_count") or 0),
        "session_ping_count": int(meta.get("session_ping_count") or 0),
    }


def set_tester_status(tester_id: str, status: str, *, note: str | None = None) -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    st = (status or "").strip().lower()
    if st not in VALID_STATUSES:
        raise ValueError(f"status non valido: {status}")
    store = load_store()
    testers = store.get("testers")
    if not isinstance(testers, dict) or tid not in testers or not isinstance(testers[tid], dict):
        raise ValueError("tester non trovato")
    meta = testers[tid]
    prev_status = _resolve_status(meta)
    meta["status"] = st
    meta["status_updated_at"] = _now_iso()
    if note:
        meta["status_note"] = str(note).strip()[:240]
    testers[tid] = meta
    store["testers"] = testers
    save_store(store)
    out = dict(meta)
    out["allowed"] = st == "approved"

    if st == "approved" and prev_status != "approved":
        out.update(_send_tester_approval_email(meta, store, testers, tid))

    return out


def delete_tester(tester_id: str, *, remove_events: bool = True) -> dict[str, Any]:
    """Rimuove tester, eventi associati e portfolio sim mobile."""
    tid = _clean_tester_id(tester_id)
    store = load_store()
    testers = store.get("testers")
    if not isinstance(testers, dict) or tid not in testers or not isinstance(testers[tid], dict):
        raise ValueError("tester non trovato")
    removed_meta = dict(testers.pop(tid))
    store["testers"] = testers
    removed_events = 0
    if remove_events:
        events = [e for e in store.get("events", []) if isinstance(e, dict)]
        kept = [e for e in events if e.get("tester_id") != tid]
        removed_events = len(events) - len(kept)
        store["events"] = kept
    save_store(store)
    sim_removed = False
    try:
        import tester_sim_inputs_io as tsi

        sim_removed = tsi.delete_sim_inputs(tid)
    except Exception:
        sim_removed = False
    return {
        "tester_id": tid,
        "removed": True,
        "events_removed": removed_events,
        "sim_inputs_removed": sim_removed,
        "display_name": removed_meta.get("display_name"),
        "email": removed_meta.get("email"),
    }


def _resolve_tester_email(meta: dict[str, Any], store: dict[str, Any], tid: str) -> str:
    to_email = str(meta.get("email") or "").strip().lower()
    if to_email:
        return to_email
    payload_email = _email_from_tester_events(store, tid)
    if payload_email:
        meta["email"] = payload_email
        testers = store.get("testers")
        if isinstance(testers, dict):
            testers[tid] = meta
            store["testers"] = testers
            save_store(store)
        return payload_email
    return ""


def _send_tester_approval_email(
    meta: dict[str, Any],
    store: dict[str, Any],
    testers: dict[str, Any],
    tid: str,
) -> dict[str, Any]:
    import tester_approval_email as tae

    to_email = _resolve_tester_email(meta, store, tid)
    welcome_url = tae.build_welcome_url(email=to_email or None)
    email_result = tae.send_tester_approval_email(
        to_email=to_email,
        display_name=str(meta.get("display_name") or tid),
    )
    patch: dict[str, Any] = {
        "email": to_email or meta.get("email") or "",
        "approval_email": {
            "ok": email_result.ok,
            "skipped": email_result.skipped,
            "reason": email_result.reason,
            "to": email_result.to,
            "welcome_url": welcome_url,
        },
    }
    if email_result.ok and email_result.to:
        meta["approval_email_sent_at"] = _now_iso()
        testers[tid] = meta
        store["testers"] = testers
        save_store(store)
        patch["approval_email_sent_at"] = meta["approval_email_sent_at"]
    return patch


def resend_tester_approval_email(tester_id: str) -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    store = load_store()
    testers = store.get("testers")
    if not isinstance(testers, dict) or tid not in testers or not isinstance(testers[tid], dict):
        raise ValueError("tester non trovato")
    meta = testers[tid]
    if _resolve_status(meta) != "approved":
        raise ValueError("tester non approvato — approva prima di inviare l'email")
    out = dict(meta)
    out["allowed"] = True
    out.update(_send_tester_approval_email(meta, store, testers, tid))
    return out


def _email_from_tester_events(store: dict[str, Any], tester_id: str) -> str | None:
    for ev in reversed(store.get("events") or []):
        if not isinstance(ev, dict) or ev.get("tester_id") != tester_id:
            continue
        payload = ev.get("payload")
        if not isinstance(payload, dict):
            continue
        raw = str(payload.get("email") or "").strip().lower()
        if raw and "@" in raw:
            return raw
    return None


def append_event(
    *,
    tester_id: str,
    module: str,
    kind: str,
    source: str = "mobile",
    ticker: str | None = None,
    payload: dict[str, Any] | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    tid = _clean_tester_id(tester_id)
    mod = (module or "").strip()
    knd = (kind or "").strip()
    src = (source or "mobile").strip()
    if mod not in VALID_MODULES:
        raise ValueError(f"module non valido: {mod}")
    if knd not in VALID_KINDS:
        raise ValueError(f"kind non valido: {knd}")
    if src not in VALID_SOURCES:
        raise ValueError(f"source non valida: {src}")

    store = load_store()
    _ensure_tester_access(tid, src)
    register_tester(tid, display_name=display_name, source=src)
    store = load_store()

    event = {
        "id": str(uuid.uuid4()),
        "tester_id": tid,
        "source": src,
        "module": mod,
        "kind": knd,
        "ticker": (ticker or "").strip().upper()[:16] or None,
        "payload": payload if isinstance(payload, dict) else {},
        "created_at": _now_iso(),
    }
    events: list[Any] = store["events"]
    events.append(event)
    # Cap store size (keep last 5000 events)
    if len(events) > 5000:
        store["events"] = events[-5000:]
    testers = store["testers"]
    if isinstance(testers.get(tid), dict):
        testers[tid]["last_seen_at"] = event["created_at"]
        testers[tid]["event_count"] = int(testers[tid].get("event_count") or 0) + 1
        if knd == "session_ping":
            testers[tid]["session_ping_count"] = int(testers[tid].get("session_ping_count") or 0) + 1
        if display_name:
            testers[tid]["display_name"] = display_name.strip()[:80]
    save_store(store)
    return event


def list_events(
    *,
    limit: int = 200,
    tester_id: str | None = None,
    module: str | None = None,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    store = load_store()
    events = [e for e in store.get("events", []) if isinstance(e, dict)]
    if tester_id:
        tid = _clean_tester_id(tester_id)
        events = [e for e in events if e.get("tester_id") == tid]
    if module and module in VALID_MODULES:
        events = [e for e in events if e.get("module") == module]
    if kind and kind in VALID_KINDS:
        events = [e for e in events if e.get("kind") == kind]
    events.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)
    return events[: max(1, min(limit, 1000))]


def build_summary() -> dict[str, Any]:
    store = load_store()
    events = [e for e in store.get("events", []) if isinstance(e, dict)]
    testers_raw = store.get("testers")
    testers_map = testers_raw if isinstance(testers_raw, dict) else {}

    now = datetime.now(timezone.utc)
    cutoff_24h = now - timedelta(hours=24)
    cutoff_7d = now - timedelta(days=7)

    def _parse_ts(s: str | None) -> datetime | None:
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None

    active_24h: set[str] = set()
    active_7d: set[str] = set()
    by_module: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    by_tester: dict[str, int] = {}
    by_status: dict[str, int] = {"pending": 0, "approved": 0, "revoked": 0}

    for ev in events:
        tid = str(ev.get("tester_id") or "")
        mod = str(ev.get("module") or "unknown")
        knd = str(ev.get("kind") or "unknown")
        by_module[mod] = by_module.get(mod, 0) + 1
        by_kind[knd] = by_kind.get(knd, 0) + 1
        if tid:
            by_tester[tid] = by_tester.get(tid, 0) + 1
        ts = _parse_ts(ev.get("created_at"))
        if ts and ts >= cutoff_24h:
            active_24h.add(tid)
        if ts and ts >= cutoff_7d:
            active_7d.add(tid)

    testers_list: list[dict[str, Any]] = []
    for tid, meta in testers_map.items():
        if not isinstance(meta, dict):
            continue
        status = _resolve_status(meta)
        by_status[status] = by_status.get(status, 0) + 1
        row: dict[str, Any] = {
            **meta,
            "tester_id": tid,
            "status": status,
            "events_in_store": by_tester.get(tid, 0),
        }
        if status == "approved":
            try:
                import tester_sim_inputs_io as tsi

                row["portfolio"] = tsi.sim_inputs_summary(tid)
            except Exception:
                row["portfolio"] = None
        testers_list.append(row)
    testers_list.sort(
        key=lambda t: str(t.get("last_seen_at") or ""),
        reverse=True,
    )

    recent = list_events(limit=40)

    return {
        "schema_version": store.get("schema_version", SCHEMA_VERSION),
        "updated_at": store.get("updated_at"),
        "store_path": str(STORE_PATH),
        "tester_count": len(testers_map),
        "events_total": len(events),
        "active_testers_24h": len(active_24h),
        "active_testers_7d": len(active_7d),
        "pending_testers": by_status.get("pending", 0),
        "approved_testers": by_status.get("approved", 0),
        "revoked_testers": by_status.get("revoked", 0),
        "by_status": by_status,
        "by_module": by_module,
        "by_kind": by_kind,
        "testers": testers_list,
        "recent_events": recent,
        "valid_modules": sorted(VALID_MODULES),
        "valid_kinds": sorted(VALID_KINDS),
    }


def build_calibration_document() -> dict[str, Any]:
    """Flatten tester events for Model Lab / export (prediction outcomes + other kinds)."""
    store = load_store()
    events = [e for e in store.get("events", []) if isinstance(e, dict)]
    summary = build_summary()
    testers_map = store.get("testers") if isinstance(store.get("testers"), dict) else {}

    calibration_rows: list[dict[str, Any]] = []
    outcome_counts: dict[str, int] = {}
    by_tester_outcome: dict[str, dict[str, int]] = {}

    for ev in events:
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        tid = str(ev.get("tester_id") or "")
        tmeta = testers_map.get(tid) if isinstance(testers_map.get(tid), dict) else {}
        row: dict[str, Any] = {
            "event_id": ev.get("id"),
            "tester_id": tid,
            "display_name": tmeta.get("display_name") or tid,
            "source": ev.get("source"),
            "module": ev.get("module"),
            "kind": ev.get("kind"),
            "ticker": ev.get("ticker"),
            "created_at": ev.get("created_at"),
            "outcome": payload.get("outcome"),
            "horizon": payload.get("horizon"),
            "pred_dir": payload.get("pred_dir"),
            "actual_dir": payload.get("actual_dir"),
            "agree": payload.get("agree"),
            "relevant": payload.get("relevant"),
            "error_type": payload.get("error_type"),
            "note": payload.get("note"),
        }
        calibration_rows.append(row)
        oc = str(payload.get("outcome") or "").strip().lower()
        if oc:
            outcome_counts[oc] = outcome_counts.get(oc, 0) + 1
            by_tester_outcome.setdefault(tid, {})
            by_tester_outcome[tid][oc] = by_tester_outcome[tid].get(oc, 0) + 1

    pred_rows = [r for r in calibration_rows if r.get("kind") == "prediction_outcome"]
    hits = sum(1 for r in pred_rows if str(r.get("outcome")).lower() == "hit")
    misses = sum(1 for r in pred_rows if str(r.get("outcome")).lower() == "miss")

    return {
        "schema_version": 1,
        "exported_at": _now_iso(),
        "source_store": str(STORE_PATH),
        "store_updated_at": store.get("updated_at"),
        "summary": {
            "tester_count": summary.get("tester_count"),
            "events_total": summary.get("events_total"),
            "prediction_outcome_rows": len(pred_rows),
            "hits": hits,
            "misses": misses,
            "hit_rate_pct": round(100 * hits / len(pred_rows), 1) if pred_rows else None,
            "outcome_counts": outcome_counts,
            "by_tester_outcome": by_tester_outcome,
            "by_module": summary.get("by_module"),
            "by_kind": summary.get("by_kind"),
        },
        "calibration_rows": calibration_rows,
        "testers": summary.get("testers"),
    }


def save_calibration_snapshot() -> dict[str, Any]:
    doc = build_calibration_document()
    CALIB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CALIB_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CALIB_PATH)
    return {"ok": True, "path": str(CALIB_PATH), "exported_at": doc["exported_at"]}
