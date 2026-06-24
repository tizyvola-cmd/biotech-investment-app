import json
from pathlib import Path

import pytest

import ai_billing
import ai_usage_tracker


def test_balance_from_prepaid_minus_spend(tmp_path, monkeypatch):
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(ai_billing, "_DATA_ROOT", data)
    monkeypatch.setattr(ai_billing, "_USAGE_LOG", data / "ai_usage_log.json")
    monkeypatch.setattr(ai_billing, "_BALANCE_CACHE", data / "cache.json")
    monkeypatch.setattr(ai_usage_tracker, "_LOG_FILE", data / "ai_usage_log.json")

    secrets = data / "ai_secrets.json"
    secrets.write_text(
        json.dumps(
            {
                "anthropic_api_key": "sk-test",
                "anthropic_prepaid_eur": 25,
                "anthropic_prepaid_set_at": "2026-06-15T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )

    ai_usage_tracker.record_usage("anthropic", "claude-sonnet-4-6", "test", 1000, 500)

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    import ai_secrets_store as sec

    monkeypatch.setattr(sec, "_DATA_ROOT", data)
    monkeypatch.setattr(sec, "_SECRETS_FILE", secrets)
    sec.load_and_apply()

    bal = ai_billing.get_anthropic_balance(force_refresh=True)
    assert bal["source"] == "estimated"
    assert bal["prepaid_eur"] == 25
    assert bal["remaining_eur"] is not None
    assert bal["remaining_eur"] < 25
