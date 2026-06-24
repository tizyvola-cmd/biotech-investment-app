from datetime import date, datetime, timezone

from prediction.eis_cohort_weekly_history import (
    append_weekly_snapshot,
    load_weekly_history,
    week_key_monday,
)


def test_week_key_monday():
    assert week_key_monday(date(2026, 5, 29)) == "2026-05-25"  # Friday -> Monday
    assert week_key_monday(date(2026, 5, 25)) == "2026-05-25"  # Monday


def test_append_weekly_snapshot_upserts_same_week(tmp_path, monkeypatch):
    hist = tmp_path / "eis_cohort_weekly_history.json"
    monkeypatch.setattr("prediction.eis_cohort_weekly_history.HISTORY_PATH", hist)

    comparison = {
        "with_eis": {"n": 10, "price_accuracy_pct": 90.0, "sign_hit_pct": 88.0},
        "without_eis": {"n": 5, "price_accuracy_pct": 85.0, "sign_hit_pct": 80.0},
        "delta_with_minus_without": {"price_accuracy_pp": 5.0, "sign_hit_pp": 8.0},
    }
    ts = datetime(2026, 5, 26, 8, 0, tzinfo=timezone.utc)
    row1 = append_weekly_snapshot(comparison, run_at=ts)
    assert row1 is not None
    assert row1["week_key"] == "2026-05-25"
    assert row1["with_eis_price_accuracy_pct"] == 90.0

    comparison["with_eis"]["price_accuracy_pct"] = 92.0
    row2 = append_weekly_snapshot(comparison, run_at=datetime(2026, 5, 28, 8, 0, tzinfo=timezone.utc))
    doc = load_weekly_history()
    assert len(doc["weeks"]) == 1
    assert doc["weeks"][0]["with_eis_price_accuracy_pct"] == 92.0
