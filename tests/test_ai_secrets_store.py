"""Tests for UI-persisted AI API keys."""

from __future__ import annotations

import json

import ai_provider
import ai_secrets_store as mod


def test_save_and_apply_anthropic(tmp_path, monkeypatch):
    secrets = tmp_path / "ai_secrets.json"
    monkeypatch.setattr(mod, "_SECRETS_FILE", secrets)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    status = mod.save_secrets(anthropic_api_key="sk-ant-test-key-12345678")
    assert status["providers"]["anthropic"]["set"] is True
    assert "sk-ant" in status["providers"]["anthropic"]["masked"]
    assert secrets.is_file()
    assert ai_provider.get_api_key("anthropic") == "sk-ant-test-key-12345678"
    assert "anthropic" in ai_provider.configured_providers()


def test_clear_anthropic(tmp_path, monkeypatch):
    secrets = tmp_path / "ai_secrets.json"
    monkeypatch.setattr(mod, "_SECRETS_FILE", secrets)
    mod.save_secrets(anthropic_api_key="sk-ant-x")
    mod.save_secrets(clear_anthropic=True)
    assert not secrets.is_file() or "anthropic_api_key" not in json.loads(
        secrets.read_text(encoding="utf-8")
    )
