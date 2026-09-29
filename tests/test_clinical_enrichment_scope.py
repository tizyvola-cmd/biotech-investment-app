"""Tests for clinical pre-CD enrichment scope (Simulation + portfolio)."""
from __future__ import annotations

import clinical_pre_cd_enrichment as cpe


def test_enrichment_scope_includes_simulation_and_portfolio(monkeypatch) -> None:
    monkeypatch.setattr(cpe, "_simulation_ticker_set", lambda: {"CLRB", "BIIB"})
    monkeypatch.setattr(cpe, "_portfolio_ticker_set", lambda: {"VIR"})
    scope = cpe._enrichment_scope_ticker_set()
    assert scope == {"CLRB", "BIIB", "VIR"}


def test_run_filters_work_to_simulation_scope(monkeypatch) -> None:
    work_all = [
        {"ticker": "CLRB", "nct_id": "NCT1", "cd_date": "2026-08-25"},
        {"ticker": "ZZZZ", "nct_id": "NCT9", "cd_date": "2026-09-01"},
    ]
    monkeypatch.setattr(cpe, "_build_work_list", lambda: list(work_all))
    monkeypatch.setattr(cpe, "_enrichment_scope_ticker_set", lambda: {"CLRB", "BIIB"})
    monkeypatch.setattr(cpe, "_portfolio_ticker_set", lambda: set())
    monkeypatch.setattr(cpe, "load_snapshot", lambda: {"records": []})
    monkeypatch.setattr(cpe, "_set_status", lambda **_kw: None)
    monkeypatch.setattr(cpe, "_write_snapshot", lambda *_a, **_kw: None)
    monkeypatch.setattr(cpe, "_finalize_snapshot_records", lambda recs, _prev: recs)

    captured: list[dict] = []

    def _fake_enrich(item: dict, *, deep: bool = False) -> dict:
        captured.append(item)
        return {**item, "ai_ok": True, "clinical_events": [{"event_date": "2026-01-01"}]}

    monkeypatch.setattr(cpe, "_enrich_one", _fake_enrich)
    monkeypatch.setattr(cpe, "_persist_snapshot_draft", lambda *_a, **_kw: None)
    monkeypatch.setattr(cpe, "should_skip_enrichment_refresh", lambda *_a, **_kw: False)

    out = cpe._run(portfolio_only=True, force=True)
    assert out.get("count") == 1
    assert captured[0]["ticker"] == "CLRB"


def test_simulation_seed_carries_nct_from_sheet(monkeypatch) -> None:
    monkeypatch.setattr(
        cpe,
        "_load_simulation_cd_by_ticker",
        lambda: {
            "CMPX": {
                "ticker": "CMPX",
                "cd_date": "2026-07-20",
                "company": "Compass Therapeutics, Inc.",
                "nct_id": "NCT04492033",
                "phase": "PHASE1 | PHASE2",
                "sponsor_match": "Partial",
            }
        },
    )
    monkeypatch.setattr(cpe, "_load_clinical_rows", lambda: [])
    monkeypatch.setattr(cpe, "_load_sec_k8_tickers", lambda: set())
    monkeypatch.setattr(cpe, "_simulation_ticker_set", lambda: {"CMPX"})

    work = cpe._build_work_list()
    cmpx = next(w for w in work if w["ticker"] == "CMPX")
    assert cmpx["nct_id"] == "NCT04492033"
    assert cmpx["cd_date"] == "2026-07-20"
