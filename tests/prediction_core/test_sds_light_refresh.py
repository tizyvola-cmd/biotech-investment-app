"""SDS light refresh — Cluster C+E without FMP network."""
from __future__ import annotations

from datetime import date, timedelta

from prediction.sds_data import refresh_sds_cohort_light


def test_light_refresh_updates_price_cluster_preserves_fmp_meta(monkeypatch):
    cd = (date.today() + timedelta(days=45)).isoformat()
    prior = {
        "rows": [
            {
                "ticker": "GOOD",
                "sds": 40.0,
                "cluster_scores": {"institutional_signal": 12.0, "price_structure": 5.0},
            }
        ],
        "n": 1,
        "generated_at": "2026-05-01T09:00:00",
        "fmp_fetched": True,
        "cluster_a_fetched": True,
    }
    recomputed = {
        "rows": [
            {
                "ticker": "GOOD",
                "sds": 44.0,
                "cluster_scores": {"institutional_signal": 12.0, "price_structure": 9.0},
            }
        ],
        "n": 1,
        "generated_at": "2026-05-29T16:30:00",
        "fmp_fetched": False,
        "cluster_a_fetched": False,
    }

    monkeypatch.setattr("prediction.sds_data.best_cached_sds_snapshot", lambda: prior)
    monkeypatch.setattr("prediction.sds_data.compute_sds_cohort", lambda **kw: dict(recomputed))
    monkeypatch.setattr("prediction.sds_data.is_sds_snapshot_degraded", lambda doc: False)
    monkeypatch.setattr("prediction.sds_data._append_sds_roi_forecasts_if_available", lambda doc: None)

    saved: list[dict] = []

    def _save(doc):
        saved.append(doc)
        return "data/sds_snapshot.json"

    monkeypatch.setattr("prediction.sds_data.save_sds_snapshot", _save)

    result = refresh_sds_cohort_light()
    assert result["mode"] == "light"
    assert saved
    doc = saved[0]
    assert doc["refresh_mode"] == "light"
    assert doc["fmp_fetched"] is True
    assert doc["cluster_a_fetched"] is True
    assert doc["last_fmp_refresh_at"] == prior["generated_at"]
    assert result["doc"]["rows"][0]["sds"] == 44.0


def test_light_refresh_falls_back_when_no_prior_snapshot(monkeypatch):
    monkeypatch.setattr("prediction.sds_data.best_cached_sds_snapshot", lambda: {"rows": []})
    monkeypatch.setattr(
        "prediction.sds_data.sync_sds_after_simulation",
        lambda **kw: {"mode": "sync", "doc": {"rows": [], "n": 0}, "n": 0},
    )
    result = refresh_sds_cohort_light()
    assert result["mode"] == "sync"
