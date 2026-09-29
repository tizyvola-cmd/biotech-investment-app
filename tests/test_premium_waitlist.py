"""Premium beta waitlist — first 1,000 get a free year."""
from __future__ import annotations

from pathlib import Path

import pytest

import premium_waitlist as pw


def _skip_notify(*, email: str, position: int):
    class _R:
        ok = True
        skipped = True

    return _R()


def test_join_waitlist_assigns_position_and_dedupes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(pw, "WAITLIST_PATH", tmp_path / "premium_beta_waitlist.json")
    monkeypatch.setattr("tester_approval_email.send_premium_waitlist_to_owner", _skip_notify)
    first = pw.join_premium_waitlist("Ada@Example.com")
    assert first["ok"] is True
    assert first["already"] is False
    assert first["position"] == 1
    assert first["founding_free_year"] is True
    again = pw.join_premium_waitlist(" ada@example.com ")
    assert again["already"] is True
    assert again["position"] == 1
    second = pw.join_premium_waitlist("bob@example.com")
    assert second["position"] == 2


def test_join_waitlist_rejects_bad_email(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pw, "WAITLIST_PATH", tmp_path / "premium_beta_waitlist.json")
    with pytest.raises(ValueError, match="email"):
        pw.join_premium_waitlist("not-an-email")


def test_list_waitlist_returns_positions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pw, "WAITLIST_PATH", tmp_path / "premium_beta_waitlist.json")
    monkeypatch.setattr("tester_approval_email.send_premium_waitlist_to_owner", _skip_notify)
    pw.join_premium_waitlist("a@example.com")
    pw.join_premium_waitlist("b@example.com")
    listed = pw.list_premium_waitlist()
    assert listed["ok"] is True
    assert listed["count"] == 2
    assert listed["entries"][0]["email"] == "a@example.com"
    assert listed["entries"][0]["position"] == 1
    assert listed["entries"][1]["email"] == "b@example.com"
    assert listed["entries"][1]["position"] == 2


def test_remove_waitlist_email(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pw, "WAITLIST_PATH", tmp_path / "premium_beta_waitlist.json")
    monkeypatch.setattr("tester_approval_email.send_premium_waitlist_to_owner", _skip_notify)
    pw.join_premium_waitlist("a@example.com")
    pw.join_premium_waitlist("b@example.com")
    rem = pw.remove_premium_waitlist_email("a@example.com")
    assert rem["removed"] is True
    listed = pw.list_premium_waitlist()
    assert listed["count"] == 1
    assert listed["entries"][0]["email"] == "b@example.com"


def test_grant_premium_from_waitlist(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import tester_feedback_io as tf

    store_path = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store_path)
    monkeypatch.setattr(pw, "WAITLIST_PATH", tmp_path / "premium_beta_waitlist.json")
    monkeypatch.setattr("tester_approval_email.send_premium_waitlist_to_owner", _skip_notify)
    monkeypatch.setattr(
        "tester_approval_email.send_tester_approval_email",
        lambda **kwargs: type("R", (), {"ok": False, "skipped": True, "reason": "test", "to": None})(),
    )
    pw.join_premium_waitlist("new.user@example.com")
    out = tf.grant_premium_from_waitlist("new.user@example.com")
    assert out["ok"] is True
    assert out["waitlist_removed"] is True
    assert out["tester"]["premium"] is True
    assert out["tester"]["allowed"] is True
    listed = pw.list_premium_waitlist()
    assert listed["count"] == 0
