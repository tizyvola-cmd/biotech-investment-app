from guidance_calendar import _merge_calendar_events_for_sim, build_catalyst_sim_entries


def test_merge_appends_fda_shaped_events(monkeypatch):
    monkeypatch.setattr(
        "guidance_calendar._fda_events_as_guidance",
        lambda: [
            {
                "ticker": "GRAL",
                "company": "GRAIL, Inc.",
                "event_type": "fda_vote",
                "asset_name": "Galleri",
                "window_start": "2026-09-23",
                "window_end": "2026-09-23",
            }
        ],
    )
    merged = _merge_calendar_events_for_sim(
        [
            {
                "ticker": "GRAL",
                "event_type": "readout",
                "window_start": "2026-11-01",
                "asset_name": "Galleri",
            }
        ]
    )
    kinds = {e["event_type"] for e in merged}
    assert kinds == {"readout", "fda_vote"}


def test_build_catalyst_sim_entries_uses_fda_date_when_nearest(monkeypatch):
    monkeypatch.setattr(
        "guidance_calendar._fda_events_as_guidance",
        lambda: [
            {
                "ticker": "PACB",
                "company": "Pacific Biosciences",
                "event_type": "fda_vote",
                "asset_name": "Onso",
                "window_start": "2026-09-16",
                "window_end": "2026-09-16",
                "timing_quote": "PAC vote",
            }
        ],
    )
    entries = build_catalyst_sim_entries([])
    by_tk = {e["Ticker"]: e for e in entries}
    assert by_tk["PACB"]["guidance_event_type"] == "fda_vote"
    assert by_tk["PACB"]["guidance_calendar_catalyst"] is True
    assert "16/09/2026" in by_tk["PACB"]["Completion Date"]


def test_build_catalyst_sim_entries_includes_amgn_from_seed(monkeypatch):
    from datetime import date as date_cls

    monkeypatch.setattr("fda_adcom_calendar.load_snapshot", lambda: {"rows": []})
    monkeypatch.setattr(
        "fda_adcom_calendar.horizon_window",
        lambda today=None: (date_cls(2026, 9, 6), date_cls(2026, 12, 6)),
    )
    entries = build_catalyst_sim_entries([])
    by_tk = {e["Ticker"]: e for e in entries}
    assert "AMGN" in by_tk
    assert by_tk["AMGN"]["guidance_event_type"] == "fda_safety"
    assert "16/09/2026" in by_tk["AMGN"]["Completion Date"]
