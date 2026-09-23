"""Tests for tester approval email."""
from __future__ import annotations

from pathlib import Path

import pytest

import tester_approval_email as tae


def test_build_welcome_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://192.168.1.203:5174")
    url = tae.build_welcome_url(email="alice@example.com")
    assert url == "http://192.168.1.203:5174/mobile/?welcome=1&email=alice%40example.com"


def test_build_welcome_url_vps_trailing_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://91.99.15.48:8765/mobile")
    url = tae.build_welcome_url(email="tizyvola@gmail.com")
    assert url == "http://91.99.15.48:8765/mobile/?welcome=1&email=tizyvola%40gmail.com"


def test_gmail_compose_url() -> None:
    url = tae.build_gmail_compose_url(
        to_email="alice@example.com",
        subject="SuperNova",
        body="Ciao",
    )
    assert url.startswith("https://mail.google.com/mail/?")
    assert "alice%40example.com" in url
    assert "view=cm" in url


def test_gmail_connected_email_defaults() -> None:
    assert tae.gmail_connected_email()
    assert "@" in tae.gmail_connected_email()


def test_send_skipped_without_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.setattr(tae, "smtp_configured", lambda: False)
    res = tae.send_tester_approval_email(to_email="bob@test.com", display_name="Bob")
    assert res.skipped is True
    assert res.reason == "smtp_non_configurato"


def test_mobile_public_url_from_public_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPERNOVA_MOBILE_PUBLIC_URL", raising=False)
    monkeypatch.setenv("SUPERNOVA_PUBLIC_HOST", "91.99.15.48")
    monkeypatch.setenv("SUPERNOVA_PORT", "8765")
    assert tae.mobile_public_url() == "http://91.99.15.48:8765/mobile"


def test_mobile_public_url_from_profile_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("SUPERNOVA_MOBILE_PUBLIC_URL", raising=False)
    monkeypatch.delenv("SUPERNOVA_PUBLIC_HOST", raising=False)
    profile = tmp_path / "desktop_web_host.env"
    profile.write_text(
        "SUPERNOVA_MOBILE_PUBLIC_URL=http://example.test/mobile\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(tae, "_PROFILE_ENV_CACHE", None)
    monkeypatch.setattr(tae, "_profile_env_files", lambda: [profile])
    assert tae.mobile_public_url() == "http://example.test/mobile"


def test_send_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    res = tae.send_tester_approval_email(to_email="bob@test.com", display_name="Bob")
    assert res.ok is True
    assert res.to == "bob@test.com"
