"""Clinical indicator normalization for AI feed."""
from clinical_pre_cd_enrichment import (
    _attach_indicators_to_events,
    _backfill_event_indicators,
    _finalize_snapshot_records,
    _indicators_from_ctgov_extracted,
    _indicators_from_study_profile,
    _normalize_global_indicators,
    _normalize_indicator_row,
)


def test_normalize_indicator_row():
    row = _normalize_indicator_row(
        {
            "label": "ORR",
            "value": "42%",
            "direction": "UP",
            "endpoint_met": "true",
        }
    )
    assert row is not None
    assert row["label"] == "ORR"
    assert row["numeric_value"] == 42.0
    assert row["direction"] == "up"
    assert row["endpoint_met"] is True


def test_attach_indicators_by_date():
    global_inds = _normalize_global_indicators(
        {
            "clinical_indicators": [
                {
                    "indicator_date": "2025-03-01",
                    "label": "Enrollment",
                    "value": "n=48",
                    "numeric_value": 48,
                    "direction": "flat",
                }
            ]
        }
    )
    events = _attach_indicators_to_events(
        [
            {
                "event_date": "2025-03-01",
                "event_title": "IR update",
                "indicators": [{"label": "ORR", "value": "38%", "direction": "up"}],
            }
        ],
        global_inds,
    )
    assert len(events[0]["indicators"]) == 2
    labels = {i["label"] for i in events[0]["indicators"]}
    assert labels == {"ORR", "Enrollment"}


def test_indicators_from_study_profile():
    rows = _indicators_from_study_profile(
        {
            "study_clinical_profile": {
                "study_success": "success",
                "primary_endpoint_label": "ORR",
                "primary_endpoint_value": "38%",
                "primary_endpoint_met": True,
                "patients_enrolled": 48,
                "patients_target": 60,
                "deaths_on_study": 0,
            }
        }
    )
    labels = {r["label"] for r in rows}
    assert "Esito studio" in labels
    assert "ORR" in labels
    assert "Reclutamento" in labels


def test_indicators_from_ctgov():
    rows = _indicators_from_ctgov_extracted(
        {
            "enrollment": 120,
            "overall_status": "Recruiting",
            "outcome_measures": [
                {"type": "Primary", "title": "ORR", "values": ["42%"], "reached": True},
            ],
            "ae_summary": ["Headache: 12%"],
        }
    )
    assert any(r["label"].startswith("Reclutamento") for r in rows)
    assert any("ORR" in r["label"] or r["value"] == "42%" for r in rows)


def test_ensure_clinical_indicators_no_crash():
    from clinical_pre_cd_enrichment import _ensure_clinical_indicators

    ai = _ensure_clinical_indicators(
        {"clinical_events": []},
        {"enrollment": 50, "overall_status": "Recruiting", "outcome_measures": []},
        {"studies_text": "NCT test", "outcomes_text": "", "ae_text": "", "drug_tokens": []},
        ticker="TEST",
        company="Test Co",
        cd_date="2026-06-01",
        window_start="2025-12-01",
        window_end="2026-06-01",
    )
    assert isinstance(ai.get("clinical_indicators"), list)


def test_backfill_event_indicators():
    global_inds = _indicators_from_study_profile(
        {
            "study_clinical_profile": {
                "study_success": "ongoing",
                "primary_endpoint_value": "N/D",
                "patients_enrolled": 10,
            }
        }
    )
    events = _backfill_event_indicators(
        [
            {
                "event_date": "2025-03-01",
                "source_type": "publication",
                "event_title": "Update",
            }
        ],
        global_inds,
    )
    assert len(events[0]["indicators"]) >= 1


def test_backfill_sec_8k_no_indicators():
    global_inds = _indicators_from_study_profile(
        {
            "study_clinical_profile": {
                "study_success": "ongoing",
                "primary_endpoint_label": "ORR",
                "primary_endpoint_value": "38%",
                "patients_enrolled": 30,
            }
        }
    )
    events = _backfill_event_indicators(
        [
            {
                "event_date": "2025-05-07",
                "source_type": "sec_8k",
                "event_title": "Results of operations (earnings)",
            },
            {
                "event_date": "2025-03-01",
                "source_type": "publication",
                "event_title": "Congress update",
            },
        ],
        global_inds,
    )
    assert events[0]["indicators"] == []
    assert len(events[1]["indicators"]) >= 1
    assert any("ORR" in str(i.get("label", "")) for i in events[1]["indicators"])


def test_finalize_snapshot_records_keeps_untouched():
    prev = {
        "AAA|NCT111": {"ticker": "AAA", "nct_id": "NCT111", "cd_date": "2026-01-01", "ai_ok": True},
        "BBB|NCT222": {"ticker": "BBB", "nct_id": "NCT222", "cd_date": "2026-03-01", "ai_ok": True},
    }
    refreshed = [
        {"ticker": "AAA", "nct_id": "NCT111", "cd_date": "2026-01-01", "ai_ok": False},
    ]
    out = _finalize_snapshot_records(refreshed, prev)
    keys = {f"{r['ticker']}|{r['nct_id']}" for r in out}
    assert keys == {"AAA|NCT111", "BBB|NCT222"}
    assert len(out) == 2
    aaa = next(r for r in out if r["ticker"] == "AAA")
    assert aaa["ai_ok"] is False
    bbb = next(r for r in out if r["ticker"] == "BBB")
    assert bbb["ai_ok"] is True
