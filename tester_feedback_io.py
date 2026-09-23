"""
Store centralizzato per feedback tester (app mobile / PWA companion).

File: ``data/tester_feedback_store.json`` — condiviso tra API desktop e client mobile.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import TESTER_FEEDBACK_CALIB_JSON, TESTER_FEEDBACK_STORE_JSON

_log = logging.getLogger(__name__)

SCHEMA_VERSION = 2
STORE_PATH = Path(TESTER_FEEDBACK_STORE_JSON)
CALIB_PATH = Path(TESTER_FEEDBACK_CALIB_JSON)
TESTER_SESSION_HEADER = "X-SuperNova-Tester-Session"

# Auth hot path: avoid reloading 5k events on every desk/brief request.
_session_lookup_lock = threading.Lock()
_session_lookup_cache: dict[str, tuple[float, str | None]] = {}
_SESSION_LOOKUP_TTL_S = 90.0

VALID_MODULES = frozenset({"dashboard", "simulation", "decisionLab", "catalystFeed", "portfolio", "opportunities"})
VALID_KINDS = frozenset({
    "session_ping",
    "prediction_outcome",
    "slope_error",
    "signal_feedback",
    "catalyst_label",
    "gain_note",
    "ui_error",
})
VALID_SOURCES = frozenset({"mobile", "desktop", "api"})
VALID_STATUSES = frozenset({"pending", "approved", "revoked"})
VALID_INTEREST_EDITIONS = frozenset({"biotech", "tech", "both"})

# Operator account — auto-approved + Access admin. Other emails Request Access → pending.
SUPERNOVA_SINGLE_OWNER_EMAILS = frozenset({"tizyvola@gmail.com"})


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
    try:
        import supernova_pg as _pg

        if _pg.enabled():
            import tester_pg_io as _tpg

            data = _tpg.load_store()
            if not isinstance(data.get("testers"), dict):
                data["testers"] = {}
            if not isinstance(data.get("events"), list):
                data["events"] = []
            data.setdefault("schema_version", SCHEMA_VERSION)
            return data
    except Exception as exc:
        _log.warning("tester_feedback postgres load failed, falling back to JSON: %s", exc)

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
    try:
        import supernova_pg as _pg

        if _pg.enabled():
            import tester_pg_io as _tpg

            return _tpg.save_store(data)
    except Exception as exc:
        _log.warning("tester_feedback postgres save failed, falling back to JSON: %s", exc)

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


# Common mistypes that otherwise create a second empty tester book (e.g. mobile @gamil).
_EMAIL_DOMAIN_TYPOS = {
    "gamil.com": "gmail.com",
    "gmial.com": "gmail.com",
    "gmal.com": "gmail.com",
    "gnail.com": "gmail.com",
    "gmail.co": "gmail.com",
}


def _normalize_email(raw: str | None) -> str:
    e = (raw or "").strip().lower()
    if not e or "@" not in e or len(e) > 120:
        raise ValueError("email non valida")
    local, _, domain = e.partition("@")
    if not local or not domain or "." not in domain:
        raise ValueError("email non valida")
    domain = _EMAIL_DOMAIN_TYPOS.get(domain, domain)
    return f"{local}@{domain}"


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
    # Legacy rows without status — treat as approved (self-service registration).
    return "approved"


def _ensure_tester_access(tid: str, source: str) -> None:
    store = load_store()
    meta = store.get("testers", {}).get(tid)
    if not isinstance(meta, dict):
        raise ValueError("tester non registrato")
    status = _resolve_status(meta)
    if status == "revoked":
        raise ValueError("accesso revocato — contatta l'amministratore")
    if status != "approved":
        raise ValueError("accesso in attesa di approvazione")


def _is_allowed_owner_email(email: str | None) -> bool:
    raw = (email or "").strip().lower()
    if not raw or "@" not in raw:
        return False
    try:
        e = _normalize_email(raw)
    except ValueError:
        return False
    return e in SUPERNOVA_SINGLE_OWNER_EMAILS


def tester_has_premium(meta: dict[str, Any] | None) -> bool:
    """
    Premium unlocks Calendar, Discovery, and Catalyst interest enroll.
    Owner email is always premium; others need meta.premium == True.
    """
    if not isinstance(meta, dict):
        return False
    email = str(meta.get("email") or "").strip()
    if _is_allowed_owner_email(email):
        return True
    return bool(meta.get("premium"))


def set_tester_premium(tester_id: str, premium: bool) -> dict[str, Any]:
    """Grant / revoke premium membership (admin). Owner email cannot be demoted."""
    tid = _clean_tester_id(tester_id)
    store = load_store()
    testers = store.get("testers")
    if not isinstance(testers, dict) or tid not in testers or not isinstance(testers[tid], dict):
        raise ValueError("tester non trovato")
    meta = testers[tid]
    email = str(meta.get("email") or "").strip()
    if _is_allowed_owner_email(email):
        meta["premium"] = True
    else:
        meta["premium"] = bool(premium)
    meta["premium_updated_at"] = _now_iso()
    testers[tid] = meta
    store["testers"] = testers
    save_store(store)
    out = dict(meta)
    out["allowed"] = _resolve_status(meta) == "approved"
    out["premium"] = tester_has_premium(meta)
    return out


def grant_premium_from_waitlist(email: str) -> dict[str, Any]:
    """
    Access tab — approve Premium request:
    ensure Basic membership (approved), set premium=true, drop waitlist row.
    """
    norm = _normalize_email(email)
    tid = _tester_id_from_email(norm)
    store = load_store()
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    meta = testers.get(tid) if isinstance(testers.get(tid), dict) else None
    created = False
    if not meta:
        local = norm.split("@")[0] or "Premium"
        register_tester(
            tid,
            email=norm,
            display_name=local,
            first_name=local[:60],
            last_name="Waitlist",
            birth_year=1990,
            source="desktop",
            interest_edition="biotech",
            interest_other="Premium waitlist",
        )
        created = True
        meta = load_store().get("testers", {}).get(tid)
        if not isinstance(meta, dict):
            raise ValueError("impossibile creare il profilo tester")

    status = _resolve_status(meta)
    approved_now = False
    if status != "approved":
        set_tester_status(tid, "approved", note="Premium waitlist grant")
        approved_now = True

    out = set_tester_premium(tid, True)

    waitlist_removed = False
    try:
        import premium_waitlist as pw

        rem = pw.remove_premium_waitlist_email(norm)
        waitlist_removed = bool(rem.get("removed"))
    except Exception as exc:
        _log.warning("premium waitlist remove after grant failed: %s", exc)

    return {
        "ok": True,
        "email": norm,
        "tester_id": tid,
        "created": created,
        "approved_now": approved_now,
        "waitlist_removed": waitlist_removed,
        "tester": out,
    }


def purge_non_owner_testers() -> dict[str, Any]:
    """No-op — multi-user Request Access is enabled (owner approves pending)."""
    return {"removed": [], "count": 0, "disabled": True}


def _clean_interest_edition(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    return s if s in VALID_INTEREST_EDITIONS else ""


def _clean_interest_other(raw: str | None) -> str:
    return (raw or "").strip()[:800]


def _clean_person_name(raw: str | None) -> str:
    return (raw or "").strip()[:60]


def _clean_birth_year(raw: Any) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        year = int(raw)
    except (TypeError, ValueError):
        return None
    y_max = datetime.now(timezone.utc).year - 16
    if year < 1920 or year > y_max:
        return None
    return year


def register_tester(
    tester_id: str,
    *,
    display_name: str | None = None,
    invite_code: str | None = None,
    email: str | None = None,
    source: str = "mobile",
    interest_edition: str | None = None,
    interest_other: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    birth_year: Any = None,
) -> dict[str, Any]:
    src = (source or "mobile").strip()
    if src not in VALID_SOURCES:
        src = "mobile"

    tid = _clean_tester_id(tester_id) if (tester_id or "").strip() else ""
    norm_email: str | None = None
    if email:
        norm_email = _normalize_email(email)
        # Always derive id from normalized email so typo domains (gamil→gmail)
        # and a stale client tester_id cannot create a second empty book.
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

    prev_status = _resolve_status(prev) if prev else None
    is_owner = bool(norm_email and _is_allowed_owner_email(norm_email))
    if is_new:
        # Owner walks straight in. Email Request Access → pending until Access tab.
        # Legacy id-only rows (no email) stay auto-approved for mobile companions.
        if is_owner or not norm_email:
            status = "approved"
        else:
            status = "pending"
    elif prev_status == "revoked":
        status = "revoked"
    elif prev_status == "pending":
        status = "pending"
    else:
        status = "approved"

    prev_email = str(prev.get("email") or "").strip().lower()
    if norm_email and prev_email and prev_email != norm_email:
        raise ValueError("email già associata a un altro profilo tester")

    edition = _clean_interest_edition(interest_edition) or str(prev.get("interest_edition") or "")
    other = _clean_interest_other(interest_other)
    if not other:
        other = str(prev.get("interest_other") or "")
    fn = _clean_person_name(first_name) or _clean_person_name(prev.get("first_name") if isinstance(prev, dict) else None)
    ln = _clean_person_name(last_name) or _clean_person_name(prev.get("last_name") if isinstance(prev, dict) else None)
    byear = _clean_birth_year(birth_year)
    if byear is None and isinstance(prev, dict):
        byear = _clean_birth_year(prev.get("birth_year"))

    if src == "desktop" and is_new and not is_owner and norm_email:
        if not fn or not ln:
            raise ValueError("nome e cognome obbligatori")
        if byear is None:
            raise ValueError("anno di nascita obbligatorio")
        if not other:
            raise ValueError("indica gli investment spaces of interest")
        if not edition:
            raise ValueError("indica se ti interessa biotech, tech o entrambe")

    composed_name = f"{fn} {ln}".strip() if (fn or ln) else ""
    testers[tid] = {
        "tester_id": tid,
        "display_name": (
            composed_name
            or (display_name or prev.get("display_name") or norm_email or tid)
        ).strip()[:80],
        "first_name": fn,
        "last_name": ln,
        "birth_year": byear,
        "email": norm_email or prev.get("email") or "",
        "invite_code": (code or prev.get("invite_code") or "").strip()[:32],
        "status": status,
        "source": prev.get("source") or src,
        "created_at": prev.get("created_at") or now,
        "last_seen_at": now,
        "event_count": int(prev.get("event_count") or 0),
        "session_ping_count": int(prev.get("session_ping_count") or 0),
        "usage_seconds_total": int(prev.get("usage_seconds_total") or 0),
        "interest_edition": edition,
        "interest_other": other,
        # Keep crash history across re-register / session_ping.
        "ui_error_count": int(prev.get("ui_error_count") or 0),
        "last_ui_error_at": prev.get("last_ui_error_at"),
        "last_ui_error_label": prev.get("last_ui_error_label"),
        "last_ui_error_message": prev.get("last_ui_error_message"),
        "open_ui_issue_id": prev.get("open_ui_issue_id"),
        "open_ui_issue_at": prev.get("open_ui_issue_at"),
        # Opaque session for per-tester book auth (hash only on disk).
        "session_token_hash": prev.get("session_token_hash"),
        "session_issued_at": prev.get("session_issued_at"),
        # Premium: Calendar / Discovery / interest enroll. Owner always true.
        "premium": True if is_owner else bool(prev.get("premium")),
        "premium_updated_at": prev.get("premium_updated_at"),
    }
    store["testers"] = testers
    save_store(store)
    meta = dict(testers[tid])
    meta["allowed"] = status == "approved"
    meta["premium"] = tester_has_premium(meta)
    # Issue a device session only on first approval — re-register must NOT rotate
    # the hash or an already-signed-in client keeps a dead token (sim-inputs 401).
    if status == "approved" and (is_new or prev_status == "pending"):
        try:
            meta["session_token"] = issue_tester_session(tid)
        except Exception as exc:
            _log.warning("issue_tester_session failed: %s", exc)
    if status == "approved" and norm_email and (is_new or prev_status == "pending"):
        def _do_approval_email() -> dict[str, Any]:
            st = load_store()
            ts = st.get("testers")
            if isinstance(ts, dict) and isinstance(ts.get(tid), dict):
                return _send_tester_approval_email(dict(ts[tid]), st, ts, tid)
            return {}

        sync_email = True
        try:
            from tester_approval_email import smtp_configured

            # Real SMTP can hang past the browser abort — queue it.
            # Dry-run / no SMTP stays sync so tests and offline get the payload.
            dry = str(os.environ.get("SUPERNOVA_SMTP_DRY_RUN") or "").strip().lower() in {
                "1",
                "true",
                "yes",
            }
            sync_email = (not smtp_configured()) or dry
        except Exception:
            sync_email = True
        if sync_email:
            try:
                meta.update(_do_approval_email())
            except Exception as exc:
                _log.warning("approval email failed: %s", exc)
        else:
            try:
                import threading

                threading.Thread(
                    target=lambda: _do_approval_email(),
                    name="tester-approval-email",
                    daemon=True,
                ).start()
                meta["approval_email_queued"] = True
            except Exception as exc:
                _log.warning("approval email thread failed: %s", exc)
    if status == "pending" and is_new and norm_email and not is_owner:
        def _do_owner_notify() -> None:
            from tester_approval_email import send_access_request_to_owner

            send_access_request_to_owner(
                requester_email=norm_email,
                display_name=str(meta.get("display_name") or norm_email),
                source=src,
                interest_edition=str(meta.get("interest_edition") or ""),
                interest_other=str(meta.get("interest_other") or ""),
                birth_year=meta.get("birth_year"),
            )

        sync_notify = True
        try:
            from tester_approval_email import smtp_configured

            dry = str(os.environ.get("SUPERNOVA_SMTP_DRY_RUN") or "").strip().lower() in {
                "1",
                "true",
                "yes",
            }
            sync_notify = (not smtp_configured()) or dry
        except Exception:
            sync_notify = True
        if sync_notify:
            try:
                from tester_approval_email import send_access_request_to_owner

                notify = send_access_request_to_owner(
                    requester_email=norm_email,
                    display_name=str(meta.get("display_name") or norm_email),
                    source=src,
                    interest_edition=str(meta.get("interest_edition") or ""),
                    interest_other=str(meta.get("interest_other") or ""),
                    birth_year=meta.get("birth_year"),
                )
                meta["owner_notify_ok"] = notify.ok
                meta["owner_notify_skipped"] = notify.skipped
                meta["owner_notify_reason"] = notify.reason
            except Exception as exc:
                _log.warning("owner access-request notify failed: %s", exc)
                meta["owner_notify_ok"] = False
                meta["owner_notify_reason"] = str(exc)
        else:
            try:
                import threading

                threading.Thread(
                    target=_do_owner_notify,
                    name="owner-access-notify",
                    daemon=True,
                ).start()
                meta["owner_notify_queued"] = True
            except Exception as exc:
                _log.warning("owner notify thread failed: %s", exc)
                meta["owner_notify_ok"] = False
                meta["owner_notify_reason"] = str(exc)
    return meta


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_tester_session(tester_id: str) -> str:
    """Create a new opaque session token for an approved tester (plaintext returned once)."""
    tid = _clean_tester_id(tester_id)
    store = load_store()
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    meta = testers.get(tid) if isinstance(testers.get(tid), dict) else None
    if not meta:
        raise ValueError("tester non trovato")
    if _resolve_status(meta) != "approved":
        raise ValueError("tester non approvato")
    token = secrets.token_urlsafe(32)
    meta = dict(meta)
    meta["session_token_hash"] = _hash_session_token(token)
    meta["session_issued_at"] = _now_iso()
    testers[tid] = meta
    store["testers"] = testers
    save_store(store)
    invalidate_session_lookup_cache()
    return token


def verify_tester_session(tester_id: str, token: str | None) -> bool:
    if not token or not str(token).strip():
        return False
    try:
        tid = _clean_tester_id(tester_id)
    except ValueError:
        return False
    store = load_store()
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    meta = testers.get(tid) if isinstance(testers.get(tid), dict) else None
    if not meta or _resolve_status(meta) != "approved":
        return False
    expected = str(meta.get("session_token_hash") or "")
    if not expected:
        return False
    return secrets.compare_digest(expected, _hash_session_token(str(token).strip()))


def find_tester_id_by_session(token: str | None) -> str | None:
    """Resolve approved tester_id from opaque device session.

    Uses Postgres roster (no events) when enabled, plus a short in-process TTL
    cache so desk/brief auth does not reload thousands of events per request.
    """
    if not token or not str(token).strip():
        return None
    digest = _hash_session_token(str(token).strip())
    now = time.time()
    with _session_lookup_lock:
        cached = _session_lookup_cache.get(digest)
        if cached is not None and now - cached[0] < _SESSION_LOOKUP_TTL_S:
            return cached[1]

    tid: str | None = None
    try:
        import supernova_pg as _pg

        if _pg.enabled():
            import tester_pg_io as _tpg

            for candidate_id, meta in _tpg.load_testers_matching_session_hash(digest):
                if not isinstance(meta, dict):
                    continue
                if _resolve_status(meta) != "approved":
                    continue
                expected = str(meta.get("session_token_hash") or "")
                if expected and secrets.compare_digest(expected, digest):
                    tid = str(candidate_id)
                    break
            if tid is None:
                # Hash index miss (legacy rows) — scan roster only, still no events.
                for candidate_id, meta in (_tpg.load_testers() or {}).items():
                    if not isinstance(meta, dict):
                        continue
                    if _resolve_status(meta) != "approved":
                        continue
                    expected = str(meta.get("session_token_hash") or "")
                    if expected and secrets.compare_digest(expected, digest):
                        tid = str(candidate_id)
                        break
    except Exception as exc:
        _log.debug("session lookup via postgres failed: %s", exc)

    if tid is None:
        store = load_store()
        testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
        for candidate_id, meta in testers.items():
            if not isinstance(meta, dict):
                continue
            if _resolve_status(meta) != "approved":
                continue
            expected = str(meta.get("session_token_hash") or "")
            if expected and secrets.compare_digest(expected, digest):
                tid = str(candidate_id)
                break

    with _session_lookup_lock:
        _session_lookup_cache[digest] = (now, tid)
        if len(_session_lookup_cache) > 10_000:
            cut = now - _SESSION_LOOKUP_TTL_S
            for k, (ts, _) in list(_session_lookup_cache.items())[:2000]:
                if ts < cut:
                    _session_lookup_cache.pop(k, None)
    return tid


def invalidate_session_lookup_cache() -> None:
    with _session_lookup_lock:
        _session_lookup_cache.clear()


def create_session_for_email(tester_id: str, email: str) -> dict[str, Any]:
    """
    Passwordless device session: prove email matches the approved tester row.
    (Full magic-link email step can wrap this later; token still required on book routes.)
    """
    tid = _clean_tester_id(tester_id)
    norm = _normalize_email(email)
    store = load_store()
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    meta = testers.get(tid) if isinstance(testers.get(tid), dict) else None
    if not meta:
        raise ValueError("tester non trovato")
    if _resolve_status(meta) != "approved":
        raise ValueError("tester non approvato")
    stored_email = _normalize_email(str(meta.get("email") or ""))
    if not stored_email or stored_email != norm:
        raise ValueError("email non corrisponde al profilo")
    token = issue_tester_session(tid)
    out = dict(meta)
    out["allowed"] = True
    out["premium"] = tester_has_premium(meta)
    out["session_token"] = token
    return out


def _usage_minutes_on_utc_day(
    tester_id: str,
    day_iso: str,
    store: dict[str, Any] | None = None,
) -> int:
    """Sum session_ping payload seconds for a UTC calendar day (YYYY-MM-DD)."""
    tid = _clean_tester_id(tester_id)
    doc = store if isinstance(store, dict) else load_store()
    events = [e for e in (doc.get("events") or []) if isinstance(e, dict)]
    total_sec = 0
    for ev in events:
        if str(ev.get("tester_id") or "") != tid:
            continue
        if str(ev.get("kind") or "") != "session_ping":
            continue
        created = str(ev.get("created_at") or "")
        day_ok = created.startswith(day_iso)
        if not day_ok:
            try:
                ts = datetime.fromisoformat(created.replace("Z", "+00:00"))
                day_ok = ts.astimezone(timezone.utc).date().isoformat() == day_iso
            except ValueError:
                day_ok = False
        if not day_ok:
            continue
        payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
        sec = payload.get("seconds")
        if isinstance(sec, (int, float)) and sec > 0:
            total_sec += int(sec)
        else:
            total_sec += 60  # legacy ping ≈ 1 minute
    return max(0, total_sec // 60)


def _usage_minutes_today(tester_id: str, store: dict[str, Any] | None = None) -> int:
    """Sum session_ping payload seconds for this UTC calendar day."""
    today = datetime.now(timezone.utc).date().isoformat()
    return _usage_minutes_on_utc_day(tester_id, today, store)


def _usage_minutes_yesterday(tester_id: str, store: dict[str, Any] | None = None) -> int:
    yday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    return _usage_minutes_on_utc_day(tester_id, yday, store)


def _usage_delta_pct(today_m: int, yesterday_m: int) -> float | None:
    """% change today vs yesterday. None when both zero."""
    if yesterday_m <= 0:
        if today_m <= 0:
            return None
        return 100.0
    return round(((today_m - yesterday_m) / yesterday_m) * 100.0, 1)


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
        "premium": tester_has_premium(meta),
        "created_at": meta.get("created_at"),
        "last_seen_at": meta.get("last_seen_at"),
        "event_count": int(meta.get("event_count") or 0),
        "session_ping_count": int(meta.get("session_ping_count") or 0),
        "usage_seconds_total": int(meta.get("usage_seconds_total") or 0),
        "usage_minutes_today": _usage_minutes_today(tid, store),
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
    if _is_allowed_owner_email(str(meta.get("email") or "")):
        meta["premium"] = True
    testers[tid] = meta
    store["testers"] = testers
    save_store(store)
    out = dict(meta)
    out["allowed"] = st == "approved"
    out["premium"] = tester_has_premium(meta)

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


def send_tester_owner_reply(
    tester_id: str,
    *,
    subject: str,
    body: str,
) -> dict[str, Any]:
    """Owner replies to an applicant from the connected Gmail mailbox."""
    tid = _clean_tester_id(tester_id)
    store = load_store()
    testers = store.get("testers")
    if not isinstance(testers, dict) or tid not in testers or not isinstance(testers[tid], dict):
        raise ValueError("tester non trovato")
    meta = testers[tid]
    to_email = _resolve_tester_email(meta, store, tid)
    if not to_email:
        raise ValueError("email tester mancante")
    from tester_approval_email import (
        build_gmail_compose_url,
        gmail_connected_email,
        send_owner_reply_to_user,
    )

    subj = (subject or "").strip()[:180] or f"SuperNova — {to_email}"
    text = (body or "").strip()
    compose = build_gmail_compose_url(to_email=to_email, subject=subj, body=text)
    sent = send_owner_reply_to_user(to_email=to_email, subject=subj, body=text)
    if sent.ok:
        meta["last_owner_reply_at"] = _now_iso()
        testers[tid] = meta
        store["testers"] = testers
        save_store(store)
    out = dict(meta)
    out["allowed"] = _resolve_status(meta) == "approved"
    out["owner_reply"] = {
        "ok": sent.ok,
        "skipped": sent.skipped,
        "reason": sent.reason,
        "to": sent.to or to_email,
        "from": gmail_connected_email(),
        "gmail_compose_url": compose,
    }
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

    # Prefer row-level Postgres writes (avoids full-store rewrite under load).
    try:
        import supernova_pg as _pg

        if _pg.enabled():
            return _append_event_postgres(
                tid=tid,
                mod=mod,
                knd=knd,
                src=src,
                ticker=ticker,
                payload=payload,
                display_name=display_name,
            )
    except Exception as exc:
        _log.warning("append_event postgres path failed, JSON fallback: %s", exc)

    store = load_store()
    # UI crash reports must land even while the tester is still pending approval.
    if knd != "ui_error":
        _ensure_tester_access(tid, src)
    else:
        meta = store.get("testers", {}).get(tid)
        if not isinstance(meta, dict):
            raise ValueError("tester non registrato")
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
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            sec = payload.get("seconds")
            add = int(sec) if isinstance(sec, (int, float)) and sec > 0 else 60
            testers[tid]["usage_seconds_total"] = int(
                testers[tid].get("usage_seconds_total") or 0
            ) + add
        if knd == "ui_error":
            # Admin queue: every UI error opens an issue until resolved in Access.
            if not isinstance(event.get("payload"), dict):
                event["payload"] = {}
            pl = event["payload"]
            if str(pl.get("issue_status") or "").lower() not in ("open", "resolved"):
                pl["issue_status"] = "open"
            if not str(pl.get("problem") or "").strip():
                # Stable short code for the admin queue.
                label_slug = re.sub(
                    r"[^a-z0-9]+",
                    "_",
                    str(pl.get("label") or "ui_error").strip().lower(),
                ).strip("_")[:48]
                pl["problem"] = label_slug or "ui_error"
            pl.setdefault("issue_opened_at", event["created_at"])
            # One open ticket per (tester, problem): supersede older open duplicates.
            problem_code = str(pl.get("problem") or "")
            if problem_code and pl.get("issue_status") == "open":
                for old in events:
                    if not isinstance(old, dict) or old is event:
                        continue
                    if old.get("tester_id") != tid or old.get("kind") != "ui_error":
                        continue
                    old_pl = old.get("payload") if isinstance(old.get("payload"), dict) else {}
                    if str(old_pl.get("problem") or "") != problem_code:
                        continue
                    if str(old_pl.get("issue_status") or "open").lower() != "open":
                        continue
                    old_pl["issue_status"] = "resolved"
                    old_pl["issue_resolved_at"] = event["created_at"]
                    old_pl["issue_resolve_note"] = "superseded_by_newer_report"
                    old["payload"] = old_pl
            testers[tid]["ui_error_count"] = int(testers[tid].get("ui_error_count") or 0) + 1
            testers[tid]["last_ui_error_at"] = event["created_at"]
            label = str(pl.get("label") or "").strip()[:80]
            message = str(pl.get("message") or pl.get("problem") or "").strip()[:400]
            if label:
                testers[tid]["last_ui_error_label"] = label
            if message:
                testers[tid]["last_ui_error_message"] = message
            if pl.get("issue_status") == "open":
                testers[tid]["open_ui_issue_id"] = event["id"]
                testers[tid]["open_ui_issue_at"] = event["created_at"]
        if display_name:
            testers[tid]["display_name"] = display_name.strip()[:80]
    save_store(store)
    return event


# Coalesce session_ping writes within this window (seconds) into one event row.
_SESSION_PING_COALESCE_SEC = int(os.environ.get("SUPERNOVA_PING_COALESCE_SEC", "180") or "180")


def _append_event_postgres(
    *,
    tid: str,
    mod: str,
    knd: str,
    src: str,
    ticker: str | None,
    payload: dict[str, Any] | None,
    display_name: str | None,
) -> dict[str, Any]:
    import tester_pg_io as tpg

    if knd != "ui_error":
        _ensure_tester_access(tid, src)
    else:
        meta0 = tpg.get_tester_meta(tid)
        if meta0 is None:
            raise ValueError("tester non registrato")

    # Ensure tester row exists (register path still uses load/save when needed).
    register_tester(tid, display_name=display_name, source=src)
    meta = tpg.get_tester_meta(tid) or {}
    now = _now_iso()
    pl_in = payload if isinstance(payload, dict) else {}

    # ── session_ping coalesce: bump last ping instead of inserting a new row ──
    if knd == "session_ping":
        add = pl_in.get("seconds")
        add_sec = int(add) if isinstance(add, (int, float)) and add > 0 else 60
        last = tpg.latest_session_ping(tid)
        coalesce = False
        if last and isinstance(last.get("created_at"), str):
            try:
                ts = datetime.fromisoformat(str(last["created_at"]).replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - ts.astimezone(timezone.utc)).total_seconds()
                coalesce = age < max(30, _SESSION_PING_COALESCE_SEC)
            except ValueError:
                coalesce = False
        if coalesce and last:
            old_pl = last.get("payload") if isinstance(last.get("payload"), dict) else {}
            old_sec = old_pl.get("seconds")
            merged = int(old_sec) if isinstance(old_sec, (int, float)) else 0
            old_pl = dict(old_pl)
            old_pl["seconds"] = merged + add_sec
            old_pl["coalesced"] = int(old_pl.get("coalesced") or 0) + 1
            last = dict(last)
            last["payload"] = old_pl
            tpg.update_event_body(str(last.get("id")), last)
            meta = dict(meta)
            meta["last_seen_at"] = now
            meta["session_ping_count"] = int(meta.get("session_ping_count") or 0) + 1
            meta["usage_seconds_total"] = int(meta.get("usage_seconds_total") or 0) + add_sec
            if display_name:
                meta["display_name"] = display_name.strip()[:80]
            tpg.upsert_tester_meta(tid, meta)
            return last

    event = {
        "id": str(uuid.uuid4()),
        "tester_id": tid,
        "source": src,
        "module": mod,
        "kind": knd,
        "ticker": (ticker or "").strip().upper()[:16] or None,
        "payload": dict(pl_in),
        "created_at": now,
    }

    meta = dict(meta)
    meta["last_seen_at"] = now
    meta["event_count"] = int(meta.get("event_count") or 0) + 1
    if knd == "session_ping":
        meta["session_ping_count"] = int(meta.get("session_ping_count") or 0) + 1
        sec = pl_in.get("seconds")
        add = int(sec) if isinstance(sec, (int, float)) and sec > 0 else 60
        meta["usage_seconds_total"] = int(meta.get("usage_seconds_total") or 0) + add
    if knd == "ui_error":
        pl = event["payload"]
        if str(pl.get("issue_status") or "").lower() not in ("open", "resolved"):
            pl["issue_status"] = "open"
        if not str(pl.get("problem") or "").strip():
            label_slug = re.sub(
                r"[^a-z0-9]+",
                "_",
                str(pl.get("label") or "ui_error").strip().lower(),
            ).strip("_")[:48]
            pl["problem"] = label_slug or "ui_error"
        pl.setdefault("issue_opened_at", now)
        meta["ui_error_count"] = int(meta.get("ui_error_count") or 0) + 1
        meta["last_ui_error_at"] = now
        label = str(pl.get("label") or "").strip()[:80]
        message = str(pl.get("message") or pl.get("problem") or "").strip()[:400]
        if label:
            meta["last_ui_error_label"] = label
        if message:
            meta["last_ui_error_message"] = message
        if pl.get("issue_status") == "open":
            meta["open_ui_issue_id"] = event["id"]
            meta["open_ui_issue_at"] = now
            # Supersede older open duplicates for same problem (best-effort scan).
            problem_code = str(pl.get("problem") or "")
            if problem_code:
                store = load_store()
                for old in store.get("events") or []:
                    if not isinstance(old, dict):
                        continue
                    if old.get("tester_id") != tid or old.get("kind") != "ui_error":
                        continue
                    old_pl = old.get("payload") if isinstance(old.get("payload"), dict) else {}
                    if str(old_pl.get("problem") or "") != problem_code:
                        continue
                    if str(old_pl.get("issue_status") or "open").lower() != "open":
                        continue
                    old_pl = dict(old_pl)
                    old_pl["issue_status"] = "resolved"
                    old_pl["issue_resolved_at"] = now
                    old_pl["issue_resolve_note"] = "superseded_by_newer_report"
                    old = dict(old)
                    old["payload"] = old_pl
                    tpg.update_event_body(str(old.get("id")), old)
    if display_name:
        meta["display_name"] = display_name.strip()[:80]

    tpg.insert_event(event)
    tpg.upsert_tester_meta(tid, meta)
    return event


def resolve_ui_issue(
    event_id: str,
    *,
    note: str | None = None,
    resolved_by: str | None = None,
) -> dict[str, Any]:
    """
    Admin closes a user UI issue from Access.
    Marks the event payload issue_status=resolved and clears tester open pointer.
    """
    eid = str(event_id or "").strip()
    if not eid:
        raise ValueError("event_id richiesto")
    store = load_store()
    events: list[Any] = store.get("events") if isinstance(store.get("events"), list) else []
    found: dict[str, Any] | None = None
    for ev in events:
        if isinstance(ev, dict) and str(ev.get("id") or "") == eid:
            found = ev
            break
    if not found:
        raise ValueError("evento non trovato")
    if str(found.get("kind") or "") != "ui_error":
        raise ValueError("solo ui_error possono essere risolti qui")
    pl = found.get("payload") if isinstance(found.get("payload"), dict) else {}
    found["payload"] = pl
    if str(pl.get("issue_status") or "").lower() == "resolved":
        return {"ok": True, "already_resolved": True, "event": found}
    pl["issue_status"] = "resolved"
    pl["issue_resolved_at"] = _now_iso()
    if note and str(note).strip():
        pl["issue_resolve_note"] = str(note).strip()[:500]
    if resolved_by and str(resolved_by).strip():
        pl["issue_resolved_by"] = str(resolved_by).strip()[:120]
    tid = str(found.get("tester_id") or "")
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    meta = testers.get(tid) if tid and isinstance(testers.get(tid), dict) else None
    if isinstance(meta, dict) and str(meta.get("open_ui_issue_id") or "") == eid:
        meta["open_ui_issue_id"] = None
        meta["open_ui_issue_at"] = None
    store["updated_at"] = _now_iso()
    save_store(store)
    return {"ok": True, "already_resolved": False, "event": found}


def _is_probe_ui_error(ev: dict[str, Any]) -> bool:
    pl = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
    blob = f"{pl.get('label') or ''} {pl.get('message') or ''}".lower()
    return "manual probe" in blob or blob.strip().startswith("probe")


def _ui_issue_status(ev: dict[str, Any]) -> str:
    pl = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
    st = str(pl.get("issue_status") or "").strip().lower()
    if st in ("open", "resolved"):
        return st
    # Legacy ui_error rows: treat as open so admin can close them.
    return "open"


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
        mins_today = _usage_minutes_today(tid, store)
        mins_yday = _usage_minutes_yesterday(tid, store)
        row: dict[str, Any] = {
            **meta,
            "tester_id": tid,
            "status": status,
            "premium": tester_has_premium(meta),
            "events_in_store": by_tester.get(tid, 0),
            "usage_minutes_today": mins_today,
            "usage_minutes_yesterday": mins_yday,
            "usage_minutes_delta_pct": _usage_delta_pct(mins_today, mins_yday),
            "usage_minutes_total": int(meta.get("usage_seconds_total") or 0) // 60,
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
    recent_ui_errors = list_events(limit=80, kind="ui_error")

    real_ui_errors = [e for e in recent_ui_errors if not _is_probe_ui_error(e)]
    open_ui_issues = [
        e for e in real_ui_errors if _ui_issue_status(e) == "open"
    ]
    ui_errors_24h = 0
    for ev in real_ui_errors:
        ts = _parse_ts(ev.get("created_at"))
        if ts and ts >= cutoff_24h:
            ui_errors_24h += 1

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
        "recent_ui_errors": real_ui_errors[:40],
        "open_ui_issues": open_ui_issues[:40],
        "open_ui_issue_count": len(open_ui_issues),
        "ui_error_count": len(open_ui_issues),
        "ui_error_count_24h": ui_errors_24h,
        "ui_error_count_all": by_kind.get("ui_error", 0),
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
