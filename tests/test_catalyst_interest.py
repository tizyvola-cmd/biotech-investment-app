"""Unit tests for catalyst_interest enroll / remove (filesystem isolated)."""

from __future__ import annotations

import json
from pathlib import Path

import catalyst_interest as ci


def test_enroll_and_remove_interest_ticker(tmp_path: Path, monkeypatch) -> None:
    watch = tmp_path / "catalyst_interest_watchlist.json"
    monkeypatch.setattr(ci, "_WATCH_PATH", watch)
    monkeypatch.setattr(ci, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(ci, "_resolve_cik", lambda _tk: None)
    monkeypatch.setattr(ci, "_kick_enrichment", lambda _tk: {"clinical": True, "daily_news": True})
    monkeypatch.setattr(
        ci,
        "discover_all_catalysts",
        lambda *_a, **_k: {"ok": True, "candidate": None, "events": [], "source": None},
    )
    monkeypatch.setattr(ci, "_inject_discovered_events", lambda *_a, **_k: 0)
    called: dict[str, object] = {}

    def _fake_manual(payload: dict) -> dict:
        called["payload"] = payload
        return {"ok": True}

    import sys
    import types

    mod = types.ModuleType("manual_catalyst_insert")
    mod.append_manual_sim_entry = _fake_manual  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "manual_catalyst_insert", mod)

    res = ci.enroll_interest_ticker(
        {
            "ticker": "crdl",
            "company": "Cardiol",
            "open_pipeline": True,
        }
    )
    assert res["ok"] is True
    assert res["entry"]["ticker"] == "CRDL"
    assert res["entry"]["company"] == "Cardiol"
    assert res["roster_added"] is False
    assert res["manual_sim_added"] is True
    assert res["in_catalyst_table"] is True
    assert res["pipeline"].get("clinical") is True
    assert watch.is_file()

    snap = ci.get_interest_snapshot()
    assert snap["count"] == 1
    assert snap["entries"][0]["ticker"] == "CRDL"

    # Re-enroll with CD should replace and try manual insert
    called: dict[str, object] = {}

    def _fake_manual(payload: dict) -> dict:
        called["payload"] = payload
        return {"ok": True}

    monkeypatch.setattr(
        "manual_catalyst_insert.append_manual_sim_entry",
        _fake_manual,
        raising=False,
    )
    # Import path used inside enroll
    import sys
    import types

    mod = types.ModuleType("manual_catalyst_insert")
    mod.append_manual_sim_entry = _fake_manual  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "manual_catalyst_insert", mod)

    res2 = ci.enroll_interest_ticker(
        {"ticker": "CRDL", "cd_iso": "2026-11-15", "open_pipeline": False}
    )
    assert res2["ok"] is True
    assert res2["replaced"] is True
    assert res2["entry"]["cd_iso"] == "2026-11-15"
    assert res2["manual_sim_added"] is True
    assert called["payload"]["ticker"] == "CRDL"

    rm = ci.remove_interest_ticker("CRDL")
    assert rm["ok"] is True
    assert rm["removed"] == 1
    assert ci.get_interest_snapshot()["count"] == 0

    doc = json.loads(watch.read_text(encoding="utf-8"))
    assert doc["entries"] == []


def test_enroll_rejects_empty_ticker(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(ci, "_WATCH_PATH", tmp_path / "w.json")
    monkeypatch.setattr(ci, "_DATA_DIR", tmp_path)
    assert ci.enroll_interest_ticker({})["ok"] is False
    assert ci.enroll_interest_ticker({"ticker": "!!!"})["ok"] is False


def test_search_local_calendar_picks_nearest_future(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(ci, "_DATA_DIR", tmp_path)
    (tmp_path / "guidance_calendar_snapshot.json").write_text(
        json.dumps(
            {
                "events": [
                    {
                        "ticker": "ZZZZ",
                        "event_type": "pdufa",
                        "window_start": "2026-11-01",
                    },
                    {
                        "ticker": "ZZZZ",
                        "event_type": "cd",
                        "window_start": "2026-10-10",
                    },
                    {
                        "ticker": "OTHER",
                        "event_type": "cd",
                        "window_start": "2026-09-20",
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    hit = ci._search_local_calendar("zzzz")
    assert hit is not None
    assert hit["cd_date"] == "2026-10-10"
    assert hit["source"] == "guidance_calendar"
    all_hits = ci._collect_local_catalysts("zzzz")
    types = {str(h.get("event_type")) for h in all_hits}
    assert "cd" in types
    assert "pdufa" in types
    assert len(all_hits) == 2


def test_enroll_uses_discovered_cd(tmp_path: Path, monkeypatch) -> None:
    watch = tmp_path / "catalyst_interest_watchlist.json"
    monkeypatch.setattr(ci, "_WATCH_PATH", watch)
    monkeypatch.setattr(ci, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(ci, "_resolve_cik", lambda _tk: None)
    monkeypatch.setattr(ci, "_kick_enrichment", lambda _tk: {})
    monkeypatch.setattr(
        ci,
        "discover_all_catalysts",
        lambda *_a, **_k: {
            "ok": True,
            "candidate": {
                "cd_date": "2026-12-01",
                "nct_id": "NCT12345678",
                "source": "guidance_calendar",
                "event_type": "cd",
            },
            "events": [
                {
                    "cd_date": "2026-12-01",
                    "nct_id": "NCT12345678",
                    "source": "guidance_calendar",
                    "event_type": "cd",
                },
                {
                    "cd_date": "2026-11-15",
                    "source": "fda_adcom",
                    "event_type": "fda_vote",
                    "title": "AdCom",
                },
            ],
            "source": "guidance_calendar",
            "cik10": None,
        },
    )
    called: dict[str, object] = {}

    def _fake_manual(payload: dict) -> dict:
        called["payload"] = payload
        return {"ok": True}

    import sys
    import types

    mod = types.ModuleType("manual_catalyst_insert")
    mod.append_manual_sim_entry = _fake_manual  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "manual_catalyst_insert", mod)
    monkeypatch.setattr(ci, "_inject_discovered_events", lambda *_a, **_k: 2)

    res = ci.enroll_interest_ticker({"ticker": "ABCD", "open_pipeline": False})
    assert res["ok"] is True
    assert res["cd_iso"] == "2026-12-01"
    assert res["manual_sim_added"] is True
    assert res["in_catalyst_table"] is True
    assert res["events_injected"] == 2
    assert called["payload"]["nct_id"] == "NCT12345678"


def test_discover_all_catalysts_searches_sec_fda_and_news(monkeypatch) -> None:
    monkeypatch.setattr(ci, "_collect_local_catalysts", lambda _tk: [])
    monkeypatch.setattr(ci, "_resolve_cik", lambda _tk: "0000898173")
    monkeypatch.setattr(ci, "_resolve_company", lambda tk, hint=None: hint or "Regeneron")
    monkeypatch.setattr(
        ci,
        "_ctgov_upcoming",
        lambda *_a, **_k: [
            {"cd_date": "2026-10-01", "event_type": "cd", "source": "ctgov", "nct_id": "NCT1"}
        ],
    )
    monkeypatch.setattr(
        ci,
        "_sec_upcoming",
        lambda *_a, **_k: [
            {"cd_date": "2026-11-15", "event_type": "pdufa", "source": "sec_8k"}
        ],
    )
    monkeypatch.setattr(
        ci,
        "_fda_upcoming",
        lambda *_a, **_k: [
            {"cd_date": "2026-12-01", "event_type": "pdufa", "source": "fda_pdufa"}
        ],
    )
    monkeypatch.setattr(
        ci,
        "_news_upcoming",
        lambda *_a, **_k: [
            {"cd_date": "2026-09-20", "event_type": "congress", "source": "news"}
        ],
    )
    res = ci.discover_all_catalysts("REGN", "Regeneron")
    assert res["ok"] is True
    assert res["searched"] == {
        "local": 0,
        "ctgov": 1,
        "sec_8k": 1,
        "fda": 1,
        "news": 1,
    }
    sources = {str(e.get("source")) for e in res["events"]}
    assert sources == {"ctgov", "sec_8k", "fda_pdufa", "news"}


def test_daily_news_universe_puts_interest_tickers_first(monkeypatch) -> None:
    import daily_news_desk as desk

    monkeypatch.setattr(
        "catalyst_desk_cache.desk_hot_tickers",
        lambda: ["CRDL", "CRSP"],
    )
    monkeypatch.setattr(
        "catalyst_interest.list_interest_entries",
        lambda: [{"ticker": "REGN", "company": "Regeneron"}],
    )
    tickers = desk._universe_tickers()
    assert tickers[0] == "REGN"
    assert "CRDL" in tickers
