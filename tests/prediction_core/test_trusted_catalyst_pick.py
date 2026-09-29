"""Tests for trusted catalyst CD picking (4m/2m pre-CD horizon)."""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from data_orchestrator import (
    SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS,
    _extract_catalyst_dates,
    _pick_best_trusted_catalyst_by_ticker,
)


def _lctx_fixture_rows() -> list[dict]:
    return [
        {
            "ticker": "LCTX",
            "nct_id": "NCT05975424",
            "primary_completion_date": "2033-01-14",
            "completion_date": "2033-01-14",
            "sponsor_match": "Exact",
            "lead_sponsor": "Lineage Cell Therapeutics, Inc.",
        },
        {
            "ticker": "LCTX",
            "nct_id": "NCT04833907",
            "primary_completion_date": "2026-08-31",
            "completion_date": "2027-08-31",
            "sponsor_match": "No match",
            "lead_sponsor": "Other Sponsor",
        },
        {
            "ticker": "LCTX",
            "nct_id": "NCT05107674",
            "primary_completion_date": "2026-08-31",
            "completion_date": "2026-09-30",
            "sponsor_match": "Partial",
            "lead_sponsor": "Nxera Pharma",
        },
    ]


def test_lctx_exact_beyond_horizon_excludes_wrong_partial() -> None:
    df = pd.DataFrame(_lctx_fixture_rows())
    picks = _pick_best_trusted_catalyst_by_ticker(
        df,
        horizon_calendar_days=SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS,
        window="horizon",
        today=date(2026, 7, 9),
    )
    assert "LCTX" not in picks

    dates = _extract_catalyst_dates(df, horizon_calendar_days=SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS)
    assert "LCTX" not in dates


def test_exact_in_horizon_beats_partial(monkeypatch: pytest.MonkeyPatch) -> None:
    df = pd.DataFrame(
        [
            {
                "ticker": "BEAM",
                "nct_id": "NCT11111111",
                "primary_completion_date": "2026-09-15",
                "sponsor_match": "Exact",
            },
            {
                "ticker": "BEAM",
                "nct_id": "NCT22222222",
                "primary_completion_date": "2026-08-20",
                "sponsor_match": "Partial",
            },
        ]
    )
    picks = _pick_best_trusted_catalyst_by_ticker(
        df,
        horizon_calendar_days=120,
        window="horizon",
        today=date(2026, 7, 9),
    )
    assert picks["BEAM"]["nct_id"] == "NCT11111111"
    assert picks["BEAM"]["primary_completion_date"] == pd.Timestamp("2026-09-15")


def test_partial_used_when_no_exact(monkeypatch: pytest.MonkeyPatch) -> None:
    df = pd.DataFrame(
        [
            {
                "ticker": "XYZ",
                "nct_id": "NCT33333333",
                "primary_completion_date": "2026-10-01",
                "sponsor_match": "Partial",
            },
        ]
    )
    picks = _pick_best_trusted_catalyst_by_ticker(
        df,
        horizon_calendar_days=120,
        window="horizon",
        today=date(2026, 7, 9),
    )
    assert picks["XYZ"]["nct_id"] == "NCT33333333"


def test_mixed_date_column_parses_2033_exact() -> None:
    """Regression: bulk parse must not drop far-future ISO dates (LCTX NCT05975424)."""
    df = pd.DataFrame(
        [
            {"ticker": "LCTX", "nct_id": "NCT05975424", "primary_completion_date": "2033-01-14", "sponsor_match": "Exact"},
            {"ticker": "LCTX", "nct_id": "NCT03605654", "primary_completion_date": "2026-09-01", "sponsor_match": "Partial"},
            {"ticker": "ZZZ", "nct_id": "NCT00000001", "primary_completion_date": "2018-01", "sponsor_match": "Exact"},
        ]
    )
    picks = _pick_best_trusted_catalyst_by_ticker(
        df,
        horizon_calendar_days=120,
        window="horizon",
        today=date(2026, 7, 9),
    )
    assert "LCTX" not in picks


def test_no_match_rows_ignored() -> None:
    df = pd.DataFrame(
        [
            {
                "ticker": "AAA",
                "primary_completion_date": "2026-08-01",
                "sponsor_match": "No match",
            },
        ]
    )
    picks = _pick_best_trusted_catalyst_by_ticker(
        df,
        horizon_calendar_days=120,
        window="horizon",
        today=date(2026, 7, 9),
    )
    assert picks == {}


def test_sim_merge_trusted_pick_populates_sponsor_and_nct() -> None:
    from data_orchestrator import _sim_merge_trusted_pick_into_lookups

    row = pd.Series(
        {
            "primary_completion_date": "2026-11-01",
            "sponsor_match": "Exact",
            "partial_type": "",
            "partial_source": "",
            "nct_id": "NCT06106308",
            "lead_sponsor": "Cardiff Oncology",
            "phase": "Phase 2",
        }
    )
    date_lookup: dict = {}
    date_lookup_horizon: dict = {}
    spon_lookup: dict = {}
    ptype_lookup: dict = {}
    psource_lookup: dict = {}
    nct_lookup: dict = {}
    phase_lookup: dict = {}
    lead_lookup: dict = {}
    _sim_merge_trusted_pick_into_lookups(
        "CRDF",
        row,
        dt_col="primary_completion_date",
        date_lookup=date_lookup,
        date_lookup_horizon=date_lookup_horizon,
        spon_lookup=spon_lookup,
        ptype_lookup=ptype_lookup,
        psource_lookup=psource_lookup,
        nct_lookup=nct_lookup,
        phase_lookup=phase_lookup,
        lead_lookup=lead_lookup,
        ph_col="phase",
        nct_col="nct_id",
        ls_col="lead_sponsor",
        in_horizon=True,
    )
    assert spon_lookup["CRDF"] == "Exact"
    assert nct_lookup["CRDF"] == "NCT06106308"
    assert date_lookup_horizon["CRDF"].isoformat() == "2026-11-01"
