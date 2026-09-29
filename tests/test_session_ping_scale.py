"""Session ping coalesce + incremental PG helpers (no live DB required for unit bits)."""
from __future__ import annotations

from tester_feedback_io import _SESSION_PING_COALESCE_SEC


def test_ping_coalesce_window_default():
    assert _SESSION_PING_COALESCE_SEC >= 60
