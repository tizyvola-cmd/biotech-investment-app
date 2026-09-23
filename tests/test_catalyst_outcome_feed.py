"""Unit tests for post–Catalyst Day outcome feed helpers."""
from datetime import date

from catalyst_outcome_feed import (
    POST_CD_RETENTION_DAYS,
    catalyst_event_key,
    desk_keeps_past_catalyst,
    in_post_cd_window,
    mark_catalyst_outcome_resolved,
    is_catalyst_outcome_resolved,
    resolve_from_migrated_news_row,
)


def test_post_cd_retention_window():
    assert desk_keeps_past_catalyst(5) is True
    assert desk_keeps_past_catalyst(0) is True
    assert desk_keeps_past_catalyst(-1) is True
    assert desk_keeps_past_catalyst(-POST_CD_RETENTION_DAYS) is True
    assert desk_keeps_past_catalyst(-(POST_CD_RETENTION_DAYS + 1)) is False
    assert in_post_cd_window(0) is True
    assert in_post_cd_window(-3) is True
    assert in_post_cd_window(2) is False


def test_resolved_drops_from_desk(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "catalyst_outcome_feed._RESOLVED_PATH",
        tmp_path / "catalyst_outcome_resolved.json",
    )
    key = catalyst_event_key("CRDL", "2026-09-10", event_type="cd", product="CardiolRx")
    assert desk_keeps_past_catalyst(-2, event_key=key) is True
    mark_catalyst_outcome_resolved(key, ticker="CRDL", event_date="2026-09-10")
    assert is_catalyst_outcome_resolved(key) is True
    assert desk_keeps_past_catalyst(-2, event_key=key) is False


def test_resolve_from_migrated_news_row(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "catalyst_outcome_feed._RESOLVED_PATH",
        tmp_path / "catalyst_outcome_resolved.json",
    )
    key = catalyst_event_key("BBNX", "2026-09-15", product="Mint")
    ok = resolve_from_migrated_news_row(
        {
            "source_kind": "catalyst_outcome",
            "catalyst_event_key": key,
            "ticker": "BBNX",
            "catalyst_event_date": "2026-09-15",
            "id": "abc123",
            "link": "https://example.com/pr",
        }
    )
    assert ok is True
    assert is_catalyst_outcome_resolved(key) is True
    assert resolve_from_migrated_news_row({"source_kind": "press"}) is False
