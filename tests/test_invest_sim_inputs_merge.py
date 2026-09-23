from invest_sim_inputs_merge import merge_invest_sim_inputs


def test_preserves_mobile_open_missing_from_desktop_republish():
    existing = {
        "KZIA|2026-09-30": {
            "buyPrice": 12.5,
            "capital": 2000,
            "ignoreSheet": False,
            "investedAt": "2026-08-10T18:00:00.000Z",
        },
        "MSLE|2026-08-30": {
            "buyPrice": 8.98,
            "capital": 5000,
            "ignoreSheet": False,
            "investedAt": "2026-07-09T11:20:44.422Z",
        },
    }
    # Desktop republish without KZIA (stale local book).
    incoming = {
        "MSLE|2026-08-30": {
            "buyPrice": 8.98,
            "capital": 5000,
            "ignoreSheet": False,
            "investedAt": "2026-07-09T11:20:44.422Z",
        },
    }
    merged = merge_invest_sim_inputs(existing, incoming)
    assert "KZIA|2026-09-30" in merged
    assert merged["KZIA|2026-09-30"]["capital"] == 2000
    assert merged["MSLE|2026-08-30"]["capital"] == 5000


def test_desktop_sell_still_wins_over_stale_open():
    existing = {
        "SYRE|2026-08-20": {
            "buyPrice": 20.0,
            "capital": 1000,
            "ignoreSheet": False,
            "investedAt": "2026-07-01T10:00:00.000Z",
        },
    }
    incoming = {
        "SYRE|2026-08-20": {
            "buyPrice": 0,
            "capital": 0,
            "ignoreSheet": True,
            "investedAt": "2026-07-01T10:00:00.000Z",
            "soldAt": "2026-08-10T12:00:00.000Z",
            "closedPnlEur": 50,
        },
    }
    merged = merge_invest_sim_inputs(existing, incoming)
    assert merged["SYRE|2026-08-20"]["ignoreSheet"] is True
    assert merged["SYRE|2026-08-20"]["closedPnlEur"] == 50


def test_rebuy_after_sell_keeps_new_open():
    existing = {
        "BBNX|2026-09-30": {
            "buyPrice": 0,
            "capital": 0,
            "ignoreSheet": True,
            "investedAt": "2026-06-01T10:00:00.000Z",
            "soldAt": "2026-08-01T10:00:00.000Z",
            "closedPnlEur": 10,
        },
    }
    incoming = {
        "BBNX|2026-09-30": {
            "buyPrice": 15.9,
            "capital": 2428,
            "ignoreSheet": False,
            "investedAt": "2026-08-10T06:45:00.000Z",
        },
    }
    merged = merge_invest_sim_inputs(existing, incoming)
    assert merged["BBNX|2026-09-30"]["capital"] == 2428
    assert merged["BBNX|2026-09-30"].get("ignoreSheet") is False
