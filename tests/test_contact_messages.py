"""Contact form messages for Access tab."""
from __future__ import annotations

from pathlib import Path

import contact_messages as cm


def test_submit_and_list(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cm, "CONTACT_PATH", tmp_path / "contact_messages.json")
    out = cm.submit_contact_message(
        email="Ada@Example.com",
        first_name="Ada",
        last_name="Lovelace",
        message="Hello SuperNova team",
    )
    assert out["ok"] is True
    assert out["id"]
    listed = cm.list_contact_messages()
    assert listed["count"] == 1
    assert listed["unread"] == 1
    row = listed["entries"][0]
    assert row["email"] == "ada@example.com"
    assert row["first_name"] == "Ada"
    assert row["last_name"] == "Lovelace"
    assert "Hello" in row["message"]


def test_rejects_bad_email(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cm, "CONTACT_PATH", tmp_path / "contact_messages.json")
    try:
        cm.submit_contact_message(
            email="not-email",
            first_name="A",
            last_name="B",
            message="hi there",
        )
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_dismiss(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cm, "CONTACT_PATH", tmp_path / "contact_messages.json")
    out = cm.submit_contact_message(
        email="bob@example.com",
        first_name="Bob",
        last_name="Builder",
        message="Please call me",
    )
    rem = cm.dismiss_contact_message(out["id"])
    assert rem["removed"] is True
    assert cm.list_contact_messages()["count"] == 0
