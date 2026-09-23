"""AI daily budget + session lookup smoke tests."""
from __future__ import annotations

import ai_user_budget as aub


def test_ai_budget_allows_then_blocks(monkeypatch):
    monkeypatch.setenv("SUPERNOVA_AI_BUDGET_PER_DAY", "3")
    monkeypatch.setenv("SUPERNOVA_AI_BUDGET_WINDOW_S", "3600")
    aub._hits.clear()
    key = aub.budget_key(tester_id="alice_at_example.com", client_ip="1.2.3.4")
    assert key == "tester:alice_at_example.com"
    for _ in range(3):
        ok, meta = aub.allow(key)
        assert ok is True
        assert meta["remaining"] >= 0
    ok, meta = aub.allow(key)
    assert ok is False
    assert meta["remaining"] == 0
    assert meta["retry_after_s"] > 0


def test_ai_budget_falls_back_to_ip(monkeypatch):
    monkeypatch.setenv("SUPERNOVA_AI_BUDGET_PER_DAY", "2")
    aub._hits.clear()
    key = aub.budget_key(tester_id=None, client_ip="9.9.9.9")
    assert key == "ip:9.9.9.9"
    assert aub.allow(key)[0] is True
    assert aub.allow(key)[0] is True
    assert aub.allow(key)[0] is False


def test_desk_refresh_allows_tester_session():
    from supernova_api import _path_allows_tester_session

    assert _path_allows_tester_session("/api/mobile/dashboard-snapshot/refresh")
    assert not _path_allows_tester_session("/api/mobile/dashboard-snapshot")
