import pytest

from prediction.cd_pattern_polygon_accuracy import (
    build_cd_pattern_polygon_overview,
    build_correlation_timeline,
    compute_polygon_match_pct,
)


def test_compute_polygon_match_pct_bounds():
    rec = {
        "ticker": "TEST",
        "affidabilita_calib": 80,
        "close_m60_cal": 10.0,
        "close_m30_cal": 11.0,
        "close_m10_cal": 12.0,
        "close_m7": 12.5,
        "close_m5": 13.0,
        "close_m3": 13.5,
        "price_at_cd": 14.0,
        "phase": "Phase 3",
    }
    m = compute_polygon_match_pct(rec, -10)
    assert m is not None
    assert 0 <= m <= 100


def test_build_overview_shape():
    doc = build_cd_pattern_polygon_overview({})
    assert "correlation_timeline" in doc
    assert len(doc["correlation_timeline"]) == 5
    for row in doc["correlation_timeline"]:
        assert "window" in row
        assert "days_mid" in row
        assert "corr_match_stock" in row


def test_polygon_learning_history_append(tmp_path, monkeypatch):
    import prediction.cd_pattern_polygon_accuracy as mod

    path = tmp_path / "cd_pattern_polygon_accuracy.json"
    monkeypatch.setattr(mod, "_POLYGON_ACCURACY_JSON", path)

    prev = {
        "generated_at": "2026-01-01",
        "correlation_timeline": [],
        "effectiveness": {"mean_corr_match_stock": 0.2, "bins_with_data": 1},
        "n_samples": 10,
        "n_events": 2,
        "learning_history": [{"week": "2026-01-01", "mean_corr_match_stock": 0.2, "n_samples": 10, "n_events": 2}],
    }
    mod._save_json(path, prev)

    doc = mod.build_cd_pattern_polygon_overview({})
    doc["effectiveness"] = {"mean_corr_match_stock": 0.35, "bins_with_data": 2}
    doc["n_samples"] = 20
    doc["n_events"] = 4
    doc = mod.append_polygon_learning_history(doc, prev)
    assert len(doc["learning_history"]) == 2
    assert doc["learning_history"][-1]["mean_corr_match_stock"] == 0.35

    changes = mod.polygon_mean_corr_changes(prev, doc)
    assert len(changes) == 1
    assert changes[0]["from"] == 0.2
    assert changes[0]["to"] == 0.35


def test_correlation_timeline_with_synthetic_pairs():
    samples = [
        {"days_before_cd": 45, "match_pct": 80, "stock_pct": 10},
        {"days_before_cd": 50, "match_pct": 70, "stock_pct": 5},
        {"days_before_cd": 40, "match_pct": 90, "stock_pct": 15},
    ]
    timeline = build_correlation_timeline(samples)
    w1 = next(r for r in timeline if r["window_id"] == "w1")
    assert w1["n_samples"] == 3
    assert w1["corr_match_stock"] is not None
    assert w1["corr_match_stock"] > 0.9
