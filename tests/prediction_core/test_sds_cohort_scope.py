"""SDS cohort window aligned with Simulation monitor horizon."""
from __future__ import annotations

from datetime import date, timedelta

from prediction.sds_data import (
    SDS_COHORT_MAX_DAYS_TO_CD,
    SDS_COHORT_POST_CD_DAYS,
    _sim_row_in_sds_cohort,
    simulation_cohort_tickers,
    sync_sds_cohort_from_simulation,
)


def test_sim_row_in_sds_cohort_window(monkeypatch):
    cd_hot = (date.today() + timedelta(days=30)).isoformat()
    cd_watch = (date.today() + timedelta(days=90)).isoformat()
    cd_beyond = (date.today() + timedelta(days=SDS_COHORT_MAX_DAYS_TO_CD + 10)).isoformat()
    cd_past = (date.today() - timedelta(days=SDS_COHORT_POST_CD_DAYS + 5)).isoformat()

    assert _sim_row_in_sds_cohort({"Ticker": "ABCD", "Completion Date": cd_hot})
    assert _sim_row_in_sds_cohort({"Ticker": "ABCD", "Completion Date": cd_watch})
    assert not _sim_row_in_sds_cohort({"Ticker": "ABCD", "Completion Date": cd_beyond})
    assert not _sim_row_in_sds_cohort({"Ticker": "ABCD", "Completion Date": cd_past})
    assert not _sim_row_in_sds_cohort({"Ticker": "TOTALE PORTAFOGLIO", "Completion Date": cd_hot})


def test_simulation_cohort_tickers_dedupes(monkeypatch):
    cd = (date.today() + timedelta(days=45)).isoformat()
    rows = [
        {"Ticker": "XYZZ", "Completion Date": cd},
        {"Ticker": "xyzz", "Completion Date": cd},
        {"Ticker": "FARO", "Completion Date": (date.today() + timedelta(days=200)).isoformat()},
    ]
    monkeypatch.setattr("prediction.sds_data._simulation_tickers", lambda: rows)
    assert simulation_cohort_tickers() == ["XYZZ"]


def test_sync_preserves_existing_sds_scores(monkeypatch):
    cd = (date.today() + timedelta(days=45)).isoformat()
    good_row = {
        "ticker": "GOOD",
        "sds": 53.5,
        "cluster_scores": {"institutional_signal": 25.0, "price_structure": 10.0},
    }
    cached = {"rows": [good_row], "n": 1, "generated_at": "2026-01-01"}
    sim_rows = [
        {"Ticker": "GOOD", "Completion Date": cd},
        {"Ticker": "NEW1", "Completion Date": cd},
    ]

    monkeypatch.setattr("prediction.sds_data._simulation_tickers", lambda: sim_rows)
    monkeypatch.setattr("prediction.sds_data.best_cached_sds_snapshot", lambda: cached)
    monkeypatch.setattr("prediction.sds_data.load_sds_snapshot", lambda: cached)
    monkeypatch.setattr("prediction.sds_data.load_sds_snapshot_good", lambda: cached)
    monkeypatch.setattr(
        "prediction.sds_data.compute_sds_cohort",
        lambda **kw: {
            "rows": [{"ticker": "NEW1", "sds": 12.0, "cluster_scores": {"institutional_signal": 0, "price_structure": 0}}],
            "n": 1,
        },
    )
    saved: list[dict] = []

    def _save(doc):
        saved.append(doc)
        return "data/sds_snapshot.json"

    monkeypatch.setattr("prediction.sds_data.save_sds_snapshot", _save)
    monkeypatch.setattr("prediction.sds_data.is_sds_snapshot_degraded", lambda doc: False)

    doc = sync_sds_cohort_from_simulation(fetch_fmp=False)
    by_tk = {r["ticker"]: r for r in doc["rows"]}
    assert by_tk["GOOD"]["sds"] == 53.5
    assert by_tk["NEW1"]["sds"] == 12.0


def test_sync_after_simulation_reports_added(monkeypatch):
    from prediction.sds_data import sync_sds_after_simulation

    cd = (date.today() + timedelta(days=45)).isoformat()
    cached = {
        "rows": [{"ticker": "GOOD", "sds": 40.0, "cluster_scores": {"institutional_signal": 20.0}}],
        "n": 1,
    }
    sim_rows = [
        {"Ticker": "GOOD", "Completion Date": cd},
        {"Ticker": "NEW1", "Completion Date": cd},
    ]

    monkeypatch.setattr("prediction.sds_data._simulation_tickers", lambda: sim_rows)
    monkeypatch.setattr("prediction.sds_data.best_cached_sds_snapshot", lambda: cached)
    monkeypatch.setattr("prediction.sds_data.load_sds_snapshot", lambda: cached)
    monkeypatch.setattr("prediction.sds_data.load_sds_snapshot_good", lambda: cached)
    monkeypatch.setattr(
        "prediction.sds_data.compute_sds_cohort",
        lambda **kw: {
            "rows": [{"ticker": "NEW1", "sds": 15.0, "cluster_scores": {"institutional_signal": 5.0}}],
            "n": 1,
        },
    )
    monkeypatch.setattr("prediction.sds_data.save_sds_snapshot", lambda doc: "data/sds_snapshot.json")
    monkeypatch.setattr("prediction.sds_data.is_sds_snapshot_degraded", lambda doc: False)
    monkeypatch.setattr("prediction.sds_data._append_sds_roi_forecasts_if_available", lambda doc: None)

    result = sync_sds_after_simulation(fetch_fmp=False)
    assert result["mode"] == "sync"
    assert result["added_tickers"] == ["NEW1"]
    assert result["n"] == 2
