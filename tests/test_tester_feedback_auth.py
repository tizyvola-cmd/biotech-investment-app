"""Tester feedback auth — email registration and access gate."""
from __future__ import annotations

from pathlib import Path

import pytest

import tester_feedback_io as tf


@pytest.fixture()
def isolated_store(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    store = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store)
    monkeypatch.delenv("SUPERNOVA_TESTER_INVITE_CODES", raising=False)
    monkeypatch.setattr(tf, "_is_allowed_owner_email", lambda _email: True)
    yield store


def test_desktop_request_requires_profile_fields(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store)
    monkeypatch.delenv("SUPERNOVA_TESTER_INVITE_CODES", raising=False)
    with pytest.raises(ValueError, match="nome e cognome"):
        tf.register_tester("", email="alice@example.com", source="desktop")
    with pytest.raises(ValueError, match="anno di nascita"):
        tf.register_tester(
            "",
            email="alice@example.com",
            source="desktop",
            first_name="Alice",
            last_name="Rossi",
            interest_edition="both",
            interest_other="AI chips, energy",
        )
    with pytest.raises(ValueError, match="investment spaces"):
        tf.register_tester(
            "",
            email="alice@example.com",
            source="desktop",
            first_name="Alice",
            last_name="Rossi",
            birth_year=1990,
            interest_edition="both",
        )
    meta = tf.register_tester(
        "",
        email="alice@example.com",
        source="desktop",
        first_name="Alice",
        last_name="Rossi",
        birth_year=1990,
        interest_edition="both",
        interest_other="AI chips, energy",
    )
    assert meta["status"] == "pending"
    assert meta["display_name"] == "Alice Rossi"
    assert meta["first_name"] == "Alice"
    assert meta["last_name"] == "Rossi"
    assert meta["birth_year"] == 1990
    assert meta["interest_edition"] == "both"
    assert meta["interest_other"] == "AI chips, energy"


def test_desktop_request_access_pending_for_non_owner(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store)
    monkeypatch.delenv("SUPERNOVA_TESTER_INVITE_CODES", raising=False)
    # Real owner check (do not force-approve every email).
    meta = tf.register_tester(
        "",
        email="alice@example.com",
        source="desktop",
        first_name="Alice",
        last_name="Rossi",
        birth_year=1990,
        interest_edition="biotech",
        interest_other="Biotech oncology",
    )
    assert meta["status"] == "pending"
    assert meta["allowed"] is False
    access = tf.get_tester_access(meta["tester_id"])
    assert access["allowed"] is False

    approved = tf.set_tester_status(meta["tester_id"], "approved")
    assert approved["allowed"] is True
    tf.append_event(
        tester_id=meta["tester_id"],
        module="dashboard",
        kind="session_ping",
        source="desktop",
        payload={"screen": "catalystDesk", "seconds": 60},
    )
    access2 = tf.get_tester_access(meta["tester_id"])
    assert access2["allowed"] is True
    assert access2["session_ping_count"] == 1
    assert access2["usage_minutes_today"] >= 1


def test_owner_email_auto_approved(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store = tmp_path / "tester_feedback_store.json"
    monkeypatch.setattr(tf, "STORE_PATH", store)
    monkeypatch.delenv("SUPERNOVA_TESTER_INVITE_CODES", raising=False)
    meta = tf.register_tester(
        "",
        email="tizyvola@gmail.com",
        display_name="Owner",
        source="desktop",
    )
    assert meta["status"] == "approved"
    assert meta["allowed"] is True


def test_mobile_register_auto_approved(isolated_store: Path) -> None:
    meta = tf.register_tester(
        "",
        email="alice@example.com",
        display_name="Alice",
        source="mobile",
    )
    assert meta["status"] == "approved"
    assert meta["allowed"] is True
    assert meta["email"] == "alice@example.com"

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
    assert meta["status"] == "approved"
    assert meta["allowed"] is True


def test_mobile_register_auto_approved_with_tester_id_only(isolated_store: Path) -> None:
    meta = tf.register_tester("legacy_id_only", display_name="Legacy", source="mobile")
    assert meta["status"] == "approved"
    assert meta["allowed"] is True
    access = tf.get_tester_access("legacy_id_only")
    assert access["allowed"] is True


def test_legacy_pending_stays_pending_until_approved(isolated_store: Path) -> None:
    store = tf.load_store()
    store["testers"]["old_pending_at_test.com"] = {
        "tester_id": "old_pending_at_test.com",
        "display_name": "Old",
        "email": "old@pending.com",
        "status": "pending",
        "source": "mobile",
        "created_at": "2026-01-01T00:00:00+00:00",
        "last_seen_at": "2026-01-01T00:00:00+00:00",
        "event_count": 0,
        "session_ping_count": 0,
    }
    tf.save_store(store)

    access = tf.get_tester_access("old_pending_at_test.com")
    assert access["status"] == "pending"
    assert access["allowed"] is False


def test_register_sends_email_dry_run(
    isolated_store: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    meta = tf.register_tester("", email="carol@test.com", display_name="Carol", source="mobile")
    assert meta["allowed"] is True
    assert meta["approval_email"]["ok"] is True
    assert meta["approval_email"]["to"] == "carol@test.com"
    assert "welcome=1" in (meta["approval_email"].get("welcome_url") or "")
    assert meta.get("approval_email_sent_at")


def test_resend_approval_email(isolated_store: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_PUBLIC_HOST", "91.99.15.48")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    meta = tf.register_tester("", email="dave@test.com", source="mobile")
    out = tf.resend_tester_approval_email(meta["tester_id"])
    assert out["approval_email"]["ok"] is True
    assert "/mobile" in (out["approval_email"].get("welcome_url") or "")


def test_revoked_tester_blocked(isolated_store: Path) -> None:
    meta = tf.register_tester("", email="revoked@test.com", source="mobile")
    tf.set_tester_status(meta["tester_id"], "revoked")
    with pytest.raises(ValueError, match="revocato"):
        tf.append_event(
            tester_id=meta["tester_id"],
            module="dashboard",
            kind="session_ping",
            source="mobile",
        )


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
