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
    monkeypatch.setenv("GITHUB_TOKEN", "test-token-github")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("AI_PROVIDER", raising=False)

    ai_provider.set_active_provider("github")
    assert override.is_file()
    data = json.loads(override.read_text(encoding="utf-8"))
    assert data.get("provider") == "github"
    assert ai_provider.get_active_provider() == "github"
    assert ai_provider.active_provider() == "github"


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
