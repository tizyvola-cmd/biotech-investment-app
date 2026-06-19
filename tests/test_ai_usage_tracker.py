"""ai_usage_tracker unit tests."""

from ai_usage_tracker import get_usage_summary, record_usage


def test_empty_summary():
    assert get_usage_summary(days=30) == {}


def test_record_appends_multiple(tmp_path, monkeypatch):
    import ai_usage_tracker as mod

    log = tmp_path / "log.json"
    monkeypatch.setattr(mod, "_LOG_FILE", log)
    mod.record_usage("github", "gpt-4o-mini", "t", 10, 5)
    mod.record_usage("anthropic", "claude-haiku-4-5-20251001", "t", 20, 10)
    rows = __import__("json").loads(log.read_text(encoding="utf-8"))
    assert len(rows) == 2
