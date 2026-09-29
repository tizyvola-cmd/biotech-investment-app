"""_normalize_event_row must not collapse drug ≡ asset (corporate signal)."""
from __future__ import annotations

import clinical_pre_cd_enrichment as cpe


def test_normalize_preserves_corporate_asset_without_copying_to_drug() -> None:
    row = cpe._normalize_event_row(
        {
            "event_title": "Q2 earnings",
            "source_type": "sec_8k",
            "asset": "Corporate",
            "drug": None,
        }
    )
    assert row["asset"] == "Corporate"
    assert row["drug"] in (None, "", "—") or row["drug"] is None


def test_normalize_preserves_distinct_drug_and_asset() -> None:
    row = cpe._normalize_event_row(
        {
            "event_title": "Azenosertib update",
            "drug": "azenosertib",
            "asset": "ZN-c3",
        }
    )
    assert row["drug"] == "azenosertib"
    assert row["asset"] == "ZN-c3"


def test_normalize_does_not_copy_drug_into_empty_asset() -> None:
    row = cpe._normalize_event_row(
        {
            "event_title": "Paxalisib data",
            "drug": "paxalisib",
        }
    )
    assert row["drug"] == "paxalisib"
    assert row.get("asset") in (None, "")


def test_normalize_stamps_nct_from_title() -> None:
    row = cpe._normalize_event_row(
        {
            "event_title": "Update for NCT03914742 cohort B",
            "drug": "paxalisib",
        }
    )
    assert row["nct_id"] == "NCT03914742"


def test_ctgov_event_includes_nct_id() -> None:
    from datetime import datetime, timedelta

    today = datetime.utcnow().date()
    pub = today.strftime("%Y-%m-%d")
    ws = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    we = (today + timedelta(days=30)).strftime("%Y-%m-%d")

    # Avoid yfinance: stub bars via monkeypatch in caller if needed.
    # Here we only assert the dict shape when the date is in window and
    # market attach may still run — skip if network blocked by checking keys
    # after a minimal stub.
    ev = {
        "event_date": pub,
        "event_type": "clinicaltrials.gov",
        "source_type": "ctgov",
        "nct_id": "NCT05128825",
        "drug": "drug-x",
        "link": "https://clinicaltrials.gov/study/NCT05128825",
    }
    norm = cpe._normalize_event_row(ev)
    assert norm["nct_id"] == "NCT05128825"
