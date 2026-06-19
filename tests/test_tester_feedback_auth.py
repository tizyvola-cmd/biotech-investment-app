"""Tester feedback auth — email registration and approval gate."""
from __future__ import annotations

from pathlib import Path

import pytest

import tester_feedback_io as tf


@pytest.fixture()
def isolated_store(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    store = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store)
    monkeypatch.delenv("SUPERNOVA_TESTER_INVITE_CODES", raising=False)
    yield store


def test_mobile_register_pending_until_approved(isolated_store: Path) -> None:
    meta = tf.register_tester(
        "",
        email="alice@example.com",
        display_name="Alice",
        source="mobile",
    )
    assert meta["status"] == "pending"
    assert meta["allowed"] is False
    assert meta["email"] == "alice@example.com"

    with pytest.raises(ValueError, match="approvazione"):
        tf.append_event(
            tester_id=meta["tester_id"],
            module="dashboard",
            kind="session_ping",
            source="mobile",
        )

    tf.set_tester_status(meta["tester_id"], "approved")

    tf.append_event(
        tester_id=meta["tester_id"],
        module="dashboard",
        kind="session_ping",
        source="mobile",
        payload={"screen": "dashboard"},
    )

    access = tf.get_tester_access(meta["tester_id"])
    assert access["allowed"] is True
    assert access["session_ping_count"] == 1


def test_invite_code_required_when_configured(isolated_store: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_TESTER_INVITE_CODES", "SN-OK,SN-02")
    with pytest.raises(ValueError, match="invito"):
        tf.register_tester("", email="bob@test.com", source="mobile")
    meta = tf.register_tester("", email="bob@test.com", invite_code="SN-OK", source="mobile")
    assert meta["status"] == "pending"


def test_mobile_register_pending_even_with_tester_id_only(isolated_store: Path) -> None:
    meta = tf.register_tester("legacy_id_only", display_name="Legacy", source="mobile")
    assert meta["status"] == "pending"
    assert meta["allowed"] is False
    access = tf.get_tester_access("legacy_id_only")
    assert access["allowed"] is False


def test_approve_sends_email_dry_run(
    isolated_store: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    meta = tf.register_tester("", email="carol@test.com", display_name="Carol", source="mobile")
    out = tf.set_tester_status(meta["tester_id"], "approved")
    assert out["allowed"] is True
    assert out["approval_email"]["ok"] is True
    assert out["approval_email"]["to"] == "carol@test.com"
    assert "welcome=1" in (out["approval_email"].get("welcome_url") or "")
    assert out.get("approval_email_sent_at")


def test_resend_approval_email(isolated_store: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_PUBLIC_HOST", "91.99.15.48")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    meta = tf.register_tester("", email="dave@test.com", source="mobile")
    tf.set_tester_status(meta["tester_id"], "approved")
    out = tf.resend_tester_approval_email(meta["tester_id"])
    assert out["approval_email"]["ok"] is True
    assert "/mobile" in (out["approval_email"].get("welcome_url") or "")


def test_delete_tester_removes_meta_and_events(isolated_store: Path) -> None:
    meta = tf.register_tester("", email="gone@test.com", source="mobile")
    tid = meta["tester_id"]
    tf.append_event(
        tester_id=tid,
        module="simulation",
        kind="session_ping",
        source="desktop",
    )
    out = tf.delete_tester(tid)
    assert out["removed"] is True
    assert out["events_removed"] == 1
    access = tf.get_tester_access(tid)
    assert access["registered"] is False
    assert tf.list_events(tester_id=tid) == []
