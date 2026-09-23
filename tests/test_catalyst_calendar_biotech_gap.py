"""Work-list coverage for biotech gap calendar scan."""
from __future__ import annotations

import json
from pathlib import Path

import catalyst_calendar as cc


def test_work_list_biotech_gap_only(tmp_path: Path, monkeypatch) -> None:
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(cc, "_DATA_DIR", data)
    monkeypatch.setattr(cc, "_ROSTER_PATH", data / "catalyst_calendar_roster.json")
    monkeypatch.setattr(cc, "_SNAPSHOT_PATH", data / "catalyst_calendar_snapshot.json")
    monkeypatch.setattr(cc, "_HISTORY_PATH", data / "catalyst_calendar_history.json")

    (data / "biotech_symbols.json").write_text(
        json.dumps(["AAAA", "BBBB", "CCCC", "ROST"]),
        encoding="utf-8",
    )
    (data / "catalyst_calendar_roster.json").write_text(
        json.dumps(
            {
                "by_ticker": {
                    "ROST": {"ticker": "ROST", "cik10": "0000000001", "company": "Roster Co"}
                }
            }
        ),
        encoding="utf-8",
    )
    (data / "catalyst_calendar_snapshot.json").write_text(
        json.dumps({"entries": []}), encoding="utf-8"
    )
    (data / "catalyst_calendar_history.json").write_text(
        json.dumps({"entries": []}), encoding="utf-8"
    )
    (data / "sec_company_tickers.json").write_text(
        json.dumps(
            {
                "0": {"ticker": "AAAA", "cik_str": "111", "title": "Alpha"},
                "1": {"ticker": "BBBB", "cik_str": "222", "title": "Beta"},
                "2": {"ticker": "CCCC", "cik_str": "333", "title": "Gamma"},
                "3": {"ticker": "ROST", "cik_str": "1", "title": "Roster Co"},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(cc, "_cik_map_from_sec_k8", lambda: {})
    monkeypatch.setattr(
        cc,
        "_ticker_cik_fallback",
        lambda: {
            "AAAA": "0000000111",
            "BBBB": "0000000222",
            "CCCC": "0000000333",
            "ROST": "0000000001",
        },
    )

    work = cc._work_list(biotech_gap_only=True)
    tickers = {w["ticker"] for w in work}
    # Gap ignores roster membership — only names already on calendar are skipped.
    assert tickers == {"AAAA", "BBBB", "CCCC", "ROST"}
    assert all(w["source"] == "biotech_universe" for w in work)

    # Once a name has calendar history, it drops out of the gap.
    (data / "catalyst_calendar_history.json").write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "id": "aaaa-1",
                        "ticker": "AAAA",
                        "event_type": "PDUFA",
                        "date_precision": "exact_date",
                        "date_value": "2027-06-01",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    work2 = cc._work_list(biotech_gap_only=True)
    assert "AAAA" not in {w["ticker"] for w in work2}
    assert {"BBBB", "CCCC", "ROST"} <= {w["ticker"] for w in work2}
