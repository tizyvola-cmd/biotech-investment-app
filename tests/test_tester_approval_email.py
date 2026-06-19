"""Tests for tester approval email."""
from __future__ import annotations

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


def test_send_skipped_without_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.delenv("SUPERNOVA_SMTP_HOST", raising=False)
    res = tae.send_tester_approval_email(to_email="bob@test.com", display_name="Bob")
    assert res.skipped is True
    assert res.reason == "smtp_non_configurato"


def test_mobile_public_url_from_public_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPERNOVA_MOBILE_PUBLIC_URL", raising=False)
    monkeypatch.setenv("SUPERNOVA_PUBLIC_HOST", "91.99.15.48")
    monkeypatch.setenv("SUPERNOVA_PORT", "8765")
    assert tae.mobile_public_url() == "http://91.99.15.48:8765/mobile"


def test_send_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERNOVA_MOBILE_PUBLIC_URL", "http://host/mobile")
    monkeypatch.setenv("SUPERNOVA_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SUPERNOVA_SMTP_USER", "user@test")
    monkeypatch.setenv("SUPERNOVA_SMTP_DRY_RUN", "1")
    res = tae.send_tester_approval_email(to_email="bob@test.com", display_name="Bob")
    assert res.ok is True
    assert res.to == "bob@test.com"
