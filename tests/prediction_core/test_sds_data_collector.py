"""Tests for SDS FMP cluster B collector."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from datetime import date, datetime, timedelta



import pytest



from prediction.sds_data_collector import (

    analyst_score_from_grades,

    compute_days_to_cover,

    fetch_analyst_grades_fmp,

    fetch_short_interest_fmp,

    is_tier1_firm,

    load_cached_cluster_b,

)





def test_analyst_score_tier1_upgrade():

    today = date.today().isoformat()

    grades = [

        {

            "date": today,

            "gradingCompany": "Goldman Sachs",

            "previousGrade": "Neutral",

            "newGrade": "Buy",

        },

        {

            "date": today,

            "gradingCompany": "Small Cap LLC",

            "previousGrade": "Hold",

            "newGrade": "Buy",

        },

    ]

    out = analyst_score_from_grades(grades)

    assert out["analyst_upgrade_score"] == 8.0

    assert out["analyst_events_n"] == 2





def test_analyst_score_init_capped_at_8():

    today = date.today().isoformat()

    grades = [

        {"date": today, "gradingCompany": "Leerink Partners", "previousGrade": "", "newGrade": "Buy"},

        {"date": today, "gradingCompany": "Jefferies", "previousGrade": "N/A", "newGrade": "Outperform"},

    ]

    out = analyst_score_from_grades(grades)

    assert out["analyst_upgrade_score"] == 8.0





def test_analyst_score_ignores_old_grades():

    old = (date.today() - timedelta(days=61)).isoformat()

    grades = [{"date": old, "gradingCompany": "Goldman Sachs", "previousGrade": "Hold", "newGrade": "Buy"}]

    out = analyst_score_from_grades(grades)

    assert out["analyst_upgrade_score"] == 0.0

    assert out["analyst_events_n"] == 0





def test_analyst_score_reiterated_zero_points():

    today = date.today().isoformat()

    grades = [

        {

            "date": today,

            "gradingCompany": "HC Wainwright",

            "action": "reiterated",

            "previousGrade": "Buy",

            "newGrade": "Buy",

        },

    ]

    out = analyst_score_from_grades(grades)

    assert out["analyst_upgrade_score"] == 3.0

    assert len(out["analyst_events_60d"]) == 1

    assert out["analyst_events_n"] == 1





def test_tier1_firm_names():

    assert is_tier1_firm("Evercore ISI")

    assert is_tier1_firm("RBC Capital Markets")

    assert is_tier1_firm("HC Wainwright & Co.")

    assert not is_tier1_firm("Random Broker LLC")





def test_compute_days_to_cover():

    dtc = compute_days_to_cover(20.0, 10_000_000.0, [100_000.0] * 20)

    assert dtc == 20.0





def test_fetch_short_interest_api_failure_returns_none(monkeypatch):

    monkeypatch.setattr("prediction.sds_data_collector.fmp_api_key", lambda: "test-key")

    monkeypatch.setattr("prediction.sds_data_collector._fmp_get", lambda *a, **k: None)

    monkeypatch.setattr("prediction.sds_data_collector._yfinance_short_info", lambda *a, **k: {})

    out = fetch_short_interest_fmp("TEST", use_cache=False)

    assert out["short_interest_pct"] is None

    assert out["error"] == "api_failed"





def test_fetch_short_interest_yfinance_fallback(monkeypatch):

    monkeypatch.setattr("prediction.sds_data_collector._fmp_get", lambda *a, **k: None)

    monkeypatch.setattr(

        "prediction.sds_data_collector._yfinance_short_info",

        lambda *a, **k: {"shortPercentOfFloat": 0.225, "sharesShort": 1_000_000, "shortRatio": 4.5},

    )

    out = fetch_short_interest_fmp("VYGR", use_cache=False)

    assert out["short_interest_pct"] == 22.5

    assert out["source"] == "yfinance"

    assert out["days_to_cover"] == 4.5





def test_short_interest_from_yfinance_info_fraction():

    from prediction.sds_data_collector import _short_interest_from_yfinance_info

    pct, vol, dtc = _short_interest_from_yfinance_info(

        {"shortPercentOfFloat": 0.15, "sharesShort": 500_000, "shortRatio": 3.2}

    )

    assert pct == 15.0

    assert vol == 500_000

    assert dtc == 3.2





def test_fetch_analyst_grades_api_failure_returns_none(monkeypatch):

    monkeypatch.setattr("prediction.sds_data_collector._fmp_get", lambda *a, **k: None)

    out = fetch_analyst_grades_fmp("TEST", use_cache=False)

    assert out["analyst_upgrade_score"] is None

    assert out["error"] == "api_failed"





def test_institutional_cache_roundtrip(tmp_path, monkeypatch):

    cache_file = tmp_path / "sds_institutional_cache.json"

    monkeypatch.setattr("prediction.sds_data_collector._INST_CACHE_PATH", cache_file)



    from prediction.sds_data_collector import _set_ticker_section



    _set_ticker_section(

        "VYGR",

        "short",

        {

            "ticker": "VYGR",

            "short_interest_pct": 12.5,

            "short_volume": 500000,

            "days_to_cover": 4.2,

            "source": "fmp_v4_short_float",

            "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),

        },

    )