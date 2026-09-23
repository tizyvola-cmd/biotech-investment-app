"""Runtime AI provider override + usage tracking."""

from __future__ import annotations

import json

import ai_provider
import ai_usage_tracker


def test_set_active_provider_persists(tmp_path, monkeypatch):
    override = tmp_path / "ai_provider_override.json"
    monkeypatch.setattr(ai_provider, "_OVERRIDE_FILE", override)
    monkeypatch.setattr(ai_provider, "_LEGACY_SESSION_FILE", tmp_path / "legacy.json")
    monkeypatch.setattr(ai_provider, "_runtime_provider", None)
    monkeypatch.setattr(ai_provider, "_RUNTIME_LOADED", False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-token-gemini")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    ai_provider.set_active_provider("gemini")
    assert override.is_file()
    data = json.loads(override.read_text(encoding="utf-8"))
    assert data.get("provider") == "gemini"
    assert ai_provider.get_active_provider() == "gemini"
    assert ai_provider.active_provider() == "gemini"


def test_set_active_provider_rejects_retired_github(tmp_path, monkeypatch):
    override = tmp_path / "ai_provider_override.json"
    monkeypatch.setattr(ai_provider, "_OVERRIDE_FILE", override)
    monkeypatch.setattr(ai_provider, "_LEGACY_SESSION_FILE", tmp_path / "legacy.json")
    monkeypatch.setattr(ai_provider, "_runtime_provider", None)
    monkeypatch.setattr(ai_provider, "_RUNTIME_LOADED", False)
    monkeypatch.setenv("GITHUB_TOKEN", "test-token-github")
    try:
        ai_provider.set_active_provider("github")
        raise AssertionError("expected ValueError for retired github")
    except ValueError as exc:
        assert "gemini" in str(exc).lower() or "anthropic" in str(exc).lower()


def test_load_runtime_clears_retired_github_override(tmp_path, monkeypatch):
    override = tmp_path / "ai_provider_override.json"
    override.write_text(json.dumps({"provider": "github"}), encoding="utf-8")
    monkeypatch.setattr(ai_provider, "_OVERRIDE_FILE", override)
    monkeypatch.setattr(ai_provider, "_LEGACY_SESSION_FILE", tmp_path / "legacy.json")
    monkeypatch.setattr(ai_provider, "_runtime_provider", None)
    monkeypatch.setattr(ai_provider, "_RUNTIME_LOADED", False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    assert ai_provider.get_active_provider() == "anthropic"
    assert not override.is_file()


def test_set_active_provider_gemini(tmp_path, monkeypatch):
    override = tmp_path / "ai_provider_override.json"
    monkeypatch.setattr(ai_provider, "_OVERRIDE_FILE", override)
    monkeypatch.setattr(ai_provider, "_LEGACY_SESSION_FILE", tmp_path / "legacy.json")
    monkeypatch.setattr(ai_provider, "_runtime_provider", None)
    monkeypatch.setattr(ai_provider, "_RUNTIME_LOADED", False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    ai_provider.set_active_provider("gemini")
    assert ai_provider.get_active_provider() == "gemini"
    assert ai_provider.active_provider() == "gemini"
    assert "gemini" in ai_provider.configured_providers()


def test_gemini_model_default(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_CLINICAL_MODEL", raising=False)
    assert ai_provider._gemini_model_for_task("catalyst", None) == "gemini-flash-lite-latest"
    assert ai_provider._gemini_model_for_task("summary", None) == "gemini-flash-lite-latest"


def test_record_usage_and_summary(tmp_path, monkeypatch):
    log_file = tmp_path / "ai_usage_log.json"
    monkeypatch.setattr(ai_usage_tracker, "_LOG_FILE", log_file)

    rec = ai_usage_tracker.record_usage("anthropic", "claude-sonnet-4-6", "clinical_kpi", 1000, 500)
    assert rec["input_tokens"] == 1000
    assert rec["output_tokens"] == 500
    assert rec["cost_usd"] > 0

    summary = ai_usage_tracker.get_usage_summary(days=30)
    assert "anthropic" in summary
    assert summary["anthropic"]["calls"] == 1


def test_anthropic_clinical_tasks_default_to_haiku(monkeypatch):
    monkeypatch.delenv("CATALYST_CLAUDE_MODEL", raising=False)
    monkeypatch.delenv("SUMMARY_CLAUDE_MODEL", raising=False)
    monkeypatch.delenv("CLINICAL_KPI_CLAUDE_MODEL", raising=False)
    haiku = "claude-haiku-4-5-20251001"
    assert ai_provider._anthropic_model_for_task("summary", None) == haiku
    assert ai_provider._anthropic_model_for_task("clinical_kpi", None) == haiku
    assert ai_provider._anthropic_model_for_task("deep_clinical", None) == haiku
    assert ai_provider._anthropic_model_for_task("catalyst", None) == haiku
    assert ai_provider._anthropic_model_for_task("guidance_extract", None) == haiku
