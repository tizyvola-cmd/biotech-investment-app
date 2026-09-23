"""
Postgres backend for SuperNova (optional).

Enable with::

    SUPERNOVA_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/supernova?sslmode=disable

When unset, tester stores keep using JSON files under ``data/``.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from contextlib import contextmanager
from typing import Any, Iterator

_log = logging.getLogger(__name__)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sn_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS sn_testers (
  tester_id TEXT PRIMARY KEY,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sn_tester_events (
  id TEXT PRIMARY KEY,
  tester_id TEXT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sn_tester_events_created
  ON sn_tester_events (created_at DESC);
CREATE INDEX IF NOT EXISTS sn_tester_events_tester
  ON sn_tester_events (tester_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sn_tester_sim_inputs (
  tester_id TEXT PRIMARY KEY,
  doc JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sn_rate_limit (
  bucket_key TEXT PRIMARY KEY,
  hits DOUBLE PRECISION[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_lock = threading.Lock()
_schema_ready = False


def database_url() -> str:
    raw = (
        os.environ.get("SUPERNOVA_DATABASE_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
    )
    if not raw:
        return ""
    # Local Postgres often hangs on SSL negotiation with psycopg; prefer disable.
    if "sslmode=" not in raw and ("127.0.0.1" in raw or "localhost" in raw):
        sep = "&" if "?" in raw else "?"
        raw = f"{raw}{sep}sslmode=disable"
    return raw


def enabled() -> bool:
    return bool(database_url())


def _redact_url(url: str) -> str:
    try:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(url)
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
            return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        pass
    return "postgresql://***"


def _connect():
    try:
        from psycopg import connect
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError(
            "psycopg[binary] required for Postgres "
            "(pip install 'psycopg[binary]')"
        ) from exc
    url = database_url()
    if not url:
        raise RuntimeError("SUPERNOVA_DATABASE_URL not set")
    return connect(url, row_factory=dict_row, connect_timeout=10, autocommit=False)


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready or not enabled():
        return
    with _lock:
        if _schema_ready:
            return
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(_SCHEMA_SQL)
            conn.commit()
        _schema_ready = True
        _log.info("Postgres schema ready (%s)", _redact_url(database_url()))


@contextmanager
def connection(*, advisory_lock_key: int | None = None) -> Iterator[Any]:
    """Yield a psycopg connection; optional transaction-scoped advisory lock."""
    ensure_schema()
    conn = _connect()
    try:
        if advisory_lock_key is not None:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (int(advisory_lock_key),))
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Stable advisory keys for store writers (serialize RMW across workers).
LOCK_TESTER_STORE = 710_001
LOCK_RATE_LIMIT = 710_002


def healthcheck() -> dict[str, Any]:
    if not enabled():
        return {"enabled": False, "ok": True, "backend": "json"}
    try:
        ensure_schema()
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                row = cur.fetchone()
        return {"enabled": True, "ok": bool(row and row.get("ok") == 1), "backend": "postgres"}
    except Exception as exc:
        return {"enabled": True, "ok": False, "backend": "postgres", "error": str(exc)[:200]}


def close_pool() -> None:
    global _schema_ready
    _schema_ready = False


def dumps_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)
