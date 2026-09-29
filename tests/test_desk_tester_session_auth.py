"""Desk product sheet auth: approved tester session may call /api/desk/*."""
from __future__ import annotations

from supernova_api import (
    _path_allows_tester_session,
    _extract_tester_session_from_scope,
)


def test_desk_paths_allow_tester_session():
    assert _path_allows_tester_session("/api/desk/product-briefing/lookup")
    assert _path_allows_tester_session("/api/desk/product-study-dossier")
    assert _path_allows_tester_session("/api/desk/pipeline-overview/lookup")
    assert _path_allows_tester_session("/api/market/daily-news/brief")
    assert _path_allows_tester_session("/api/market/daily-news/analyze")
    assert not _path_allows_tester_session("/api/market/daily-news/migrate")
    assert not _path_allows_tester_session("/api/refresh/run")
    assert not _path_allows_tester_session("/api/ai/secrets")


def test_extract_tester_session_header():
    scope = {
        "type": "http",
        "headers": [
            (b"x-supernova-tester-session", b"abc123session"),
            (b"host", b"example.com"),
        ],
    }
    assert _extract_tester_session_from_scope(scope) == "abc123session"
    assert _extract_tester_session_from_scope({"type": "http", "headers": []}) is None
