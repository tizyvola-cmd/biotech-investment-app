"""
Postgres persistence for tester feedback store + per-tester sim-inputs.

Used when ``SUPERNOVA_DATABASE_URL`` is set. Keeps the same dict shape as the
JSON files so ``tester_feedback_io`` / ``tester_sim_inputs_io`` stay unchanged
above ``load_store`` / ``save_store``.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import supernova_pg as pg

_log = logging.getLogger(__name__)

SCHEMA_VERSION = 2
_MAX_EVENTS = 5000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_testers() -> dict[str, dict[str, Any]]:
    """Roster only — used by session auth (never pull events)."""
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT tester_id, meta FROM sn_testers")
            return {
                str(r["tester_id"]): (r["meta"] if isinstance(r["meta"], dict) else {})
                for r in cur.fetchall()
            }


def load_testers_matching_session_hash(digest: str) -> list[tuple[str, dict[str, Any]]]:
    """Candidates whose meta.session_token_hash equals digest (status checked by caller)."""
    dig = (digest or "").strip()
    if not dig:
        return []
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT tester_id, meta
                FROM sn_testers
                WHERE meta->>'session_token_hash' = %s
                LIMIT 16
                """,
                (dig,),
            )
            rows = cur.fetchall()
    out: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        out.append((str(row["tester_id"]), meta))
    return out


def load_store() -> dict[str, Any]:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT tester_id, meta FROM sn_testers")
            testers = {
                str(r["tester_id"]): (r["meta"] if isinstance(r["meta"], dict) else {})
                for r in cur.fetchall()
            }
            cur.execute(
                """
                SELECT body FROM sn_tester_events
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (_MAX_EVENTS,),
            )
            events_desc = [r["body"] for r in cur.fetchall() if isinstance(r["body"], dict)]
            events = list(reversed(events_desc))
            cur.execute("SELECT value FROM sn_meta WHERE key = 'tester_store'")
            meta_row = cur.fetchone()
    updated_at = None
    if meta_row and isinstance(meta_row.get("value"), dict):
        updated_at = meta_row["value"].get("updated_at")
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": updated_at,
        "testers": testers,
        "events": events,
    }


def save_store(data: dict[str, Any]) -> str:
    """Replace testers + events from a full store document (advisory-locked)."""
    updated_at = _now_iso()
    testers = data.get("testers") if isinstance(data.get("testers"), dict) else {}
    events = data.get("events") if isinstance(data.get("events"), list) else []
    if len(events) > _MAX_EVENTS:
        events = events[-_MAX_EVENTS:]

    with pg.connection(advisory_lock_key=pg.LOCK_TESTER_STORE) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sn_testers")
            for tid, meta in testers.items():
                if not isinstance(meta, dict):
                    continue
                cur.execute(
                    """
                    INSERT INTO sn_testers (tester_id, meta, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    """,
                    (str(tid), pg.dumps_json(meta)),
                )
            cur.execute("DELETE FROM sn_tester_events")
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                eid = str(ev.get("id") or "").strip()
                if not eid:
                    continue
                tid = str(ev.get("tester_id") or "")
                created = str(ev.get("created_at") or updated_at)
                cur.execute(
                    """
                    INSERT INTO sn_tester_events (id, tester_id, body, created_at)
                    VALUES (%s, %s, %s::jsonb, %s::timestamptz)
                    ON CONFLICT (id) DO UPDATE
                      SET body = EXCLUDED.body,
                          tester_id = EXCLUDED.tester_id,
                          created_at = EXCLUDED.created_at
                    """,
                    (eid, tid, pg.dumps_json(ev), created),
                )
            cur.execute(
                """
                INSERT INTO sn_meta (key, value)
                VALUES ('tester_store', %s::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """,
                (pg.dumps_json({"updated_at": updated_at, "schema_version": SCHEMA_VERSION}),),
            )
    return updated_at


def load_sim_inputs(tester_id: str) -> dict[str, Any] | None:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT doc FROM sn_tester_sim_inputs WHERE tester_id = %s",
                (tester_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    doc = row.get("doc")
    return doc if isinstance(doc, dict) else None


def save_sim_inputs(tester_id: str, doc: dict[str, Any]) -> None:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sn_tester_sim_inputs (tester_id, doc, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (tester_id) DO UPDATE
                  SET doc = EXCLUDED.doc, updated_at = NOW()
                """,
                (tester_id, pg.dumps_json(doc)),
            )


def delete_sim_inputs(tester_id: str) -> bool:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM sn_tester_sim_inputs WHERE tester_id = %s",
                (tester_id,),
            )
            return cur.rowcount > 0


def get_tester_meta(tester_id: str) -> dict[str, Any] | None:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT meta FROM sn_testers WHERE tester_id = %s",
                (tester_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    meta = row.get("meta")
    return meta if isinstance(meta, dict) else {}


def upsert_tester_meta(tester_id: str, meta: dict[str, Any]) -> None:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sn_testers (tester_id, meta, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (tester_id) DO UPDATE
                  SET meta = EXCLUDED.meta, updated_at = NOW()
                """,
                (tester_id, pg.dumps_json(meta)),
            )


def insert_event(event: dict[str, Any]) -> None:
    """Append one event row (no full-store rewrite). Trims oldest beyond cap."""
    eid = str(event.get("id") or "").strip()
    if not eid:
        return
    tid = str(event.get("tester_id") or "")
    created = str(event.get("created_at") or _now_iso())
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sn_tester_events (id, tester_id, body, created_at)
                VALUES (%s, %s, %s::jsonb, %s::timestamptz)
                ON CONFLICT (id) DO UPDATE
                  SET body = EXCLUDED.body,
                      tester_id = EXCLUDED.tester_id,
                      created_at = EXCLUDED.created_at
                """,
                (eid, tid, pg.dumps_json(event), created),
            )
            # Keep table bounded without rewriting everything.
            cur.execute(
                """
                DELETE FROM sn_tester_events
                WHERE id IN (
                  SELECT id FROM sn_tester_events
                  ORDER BY created_at DESC
                  OFFSET %s
                )
                """,
                (_MAX_EVENTS,),
            )


def update_event_body(event_id: str, body: dict[str, Any]) -> None:
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE sn_tester_events
                SET body = %s::jsonb
                WHERE id = %s
                """,
                (pg.dumps_json(body), event_id),
            )


def latest_session_ping(tester_id: str) -> dict[str, Any] | None:
    """Most recent session_ping event for a tester (for coalesce)."""
    pg.ensure_schema()
    with pg.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT body FROM sn_tester_events
                WHERE tester_id = %s
                  AND body->>'kind' = 'session_ping'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (tester_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    body = row.get("body")
    return body if isinstance(body, dict) else None


def migrate_from_json(store: dict[str, Any], sim_docs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """One-shot import from JSON files into Postgres."""
    updated = save_store(store)
    n_sim = 0
    for tid, doc in sim_docs.items():
        if isinstance(doc, dict):
            save_sim_inputs(str(tid), doc)
            n_sim += 1
    testers = store.get("testers") if isinstance(store.get("testers"), dict) else {}
    events = store.get("events") if isinstance(store.get("events"), list) else []
    _log.info(
        "Migrated to Postgres: %s testers, %s events, %s sim-inputs (updated_at=%s)",
        len(testers),
        len(events),
        n_sim,
        updated,
    )
    return {
        "ok": True,
        "testers": len(testers),
        "events": len(events),
        "sim_inputs": n_sim,
        "updated_at": updated,
    }
