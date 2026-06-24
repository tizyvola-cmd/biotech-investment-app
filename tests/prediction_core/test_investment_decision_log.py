"""Test del decision log persistente entry/exit."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from prediction.investment_decision_log import (
    enrich_position_with_log,
    load_decision_log,
    update_decision_log,
)


def _pos(rk: str, cap: float, **kw):
    base = {
        "row_key": rk,
        "ticker": rk.split("|")[0],
        "completion_date": rk.split("|")[1] if "|" in rk else "",
        "capital_eur": cap,
        "buy_price_usd": 10.0,
        "pnl_pct": 0.0,
        "pnl_eur": 0.0,
        "pred5_pp": 1.5,
        "pred7_pp": 2.0,
        "affidabilita_pct": 75.0,
        "r2_fit": 0.6,
    }
    base.update(kw)
    return base


def _slope(asof: str = "2026-01-01", s20: float = 0.5, s5: float = 0.3, ru30: float = 5.0):
    return {
        "asof": asof,
        "slope_5d": s5,
        "slope_20d": s20,
        "run_up_30d": ru30,
        "source_key": "TEST|2026-01-01",
        "source_offset": "T-1",
    }


def test_first_run_creates_entry_with_existing_flag(tmp_path: Path):
    log_path = tmp_path / "log.json"
    positions = [_pos("AAA|2026-06-01", 1000.0)]
    slopes = {"AAA": _slope()}
    log = update_decision_log(
        positions=positions,
        latest_slope_by_ticker=slopes,
        log_path=log_path,
    )
    entry = log["entries"]["AAA|2026-06-01"]
    assert entry["current_open"] is True
    assert len(entry["cycles"]) == 1
    snap = entry["cycles"][0]["entry"]
    assert snap["entry_was_existing"] is True
    assert snap["slope_20d"] == 0.5
    assert snap["affidabilita_pct"] == 75.0
    assert entry["cycles"][0]["exit"] is None


def test_second_run_no_new_entry_if_already_open(tmp_path: Path):
    log_path = tmp_path / "log.json"
    positions = [_pos("AAA|2026-06-01", 1000.0)]
    slopes = {"AAA": _slope()}
    update_decision_log(positions=positions, latest_slope_by_ticker=slopes, log_path=log_path)
    # Secondo run: nessun cambiamento
    log = update_decision_log(positions=positions, latest_slope_by_ticker=slopes, log_path=log_path)
    entry = log["entries"]["AAA|2026-06-01"]
    assert len(entry["cycles"]) == 1, "no duplicate entry"
    assert entry["current_open"] is True


def test_capital_goes_to_zero_triggers_exit(tmp_path: Path):
    log_path = tmp_path / "log.json"
    slopes = {"AAA": _slope()}
    # Apri
    update_decision_log(
        positions=[_pos("AAA|2026-06-01", 1000.0)],
        latest_slope_by_ticker=slopes,
        log_path=log_path,
    )
    # Chiudi (capital = 0 → riga filtrata fuori da positions)
    log = update_decision_log(positions=[], latest_slope_by_ticker=slopes, log_path=log_path)
    entry = log["entries"]["AAA|2026-06-01"]
    assert entry["current_open"] is False
    assert entry["cycles"][0]["exit"] is not None
    assert entry["cycles"][0]["exit"]["exit_reason"] == "capital_removed"
    assert entry["cycles"][0]["exit"]["pnl_pct_at_event"] == 0.0
    assert entry["cycles"][0]["exit"]["pnl_eur_at_event"] == 0.0


def test_exit_uses_last_open_snapshot_pnl(tmp_path: Path):
    log_path = tmp_path / "log.json"
    slopes = {"AAA": _slope()}
    # Open with positive P&L mark-to-market.
    update_decision_log(
        positions=[_pos("AAA|2026-06-01", 1000.0, pnl_pct=6.75, pnl_eur=67.5)],
        latest_slope_by_ticker=slopes,
        log_path=log_path,
    )
    # Close (row removed from active positions)
    log = update_decision_log(positions=[], latest_slope_by_ticker=slopes, log_path=log_path)
    exit_snap = log["entries"]["AAA|2026-06-01"]["cycles"][0]["exit"]
    assert exit_snap is not None
    assert exit_snap["pnl_pct_at_event"] == 6.75
    assert exit_snap["pnl_eur_at_event"] == 67.5
    enriched = enrich_position_with_log(_pos("AAA|2026-06-01", 1000.0), log)
    assert enriched["exit_pnl_pct_at_event"] == 6.75
    assert enriched["exit_pnl_eur_at_event"] == 67.5
    assert enriched["holding_days"] is not None


def test_reopen_after_exit_creates_new_cycle(tmp_path: Path):
    log_path = tmp_path / "log.json"
    slopes = {"AAA": _slope()}
    # Cycle 1: apri + chiudi
    update_decision_log(positions=[_pos("AAA|2026-06-01", 1000.0)], latest_slope_by_ticker=slopes, log_path=log_path)
    update_decision_log(positions=[], latest_slope_by_ticker=slopes, log_path=log_path)
    # Cycle 2: riapri
    log = update_decision_log(
        positions=[_pos("AAA|2026-06-01", 2000.0)],
        latest_slope_by_ticker=slopes,
        log_path=log_path,
    )
    entry = log["entries"]["AAA|2026-06-01"]
    assert len(entry["cycles"]) == 2, "new cycle appended"
    assert entry["current_open"] is True
    # Il primo cycle resta chiuso, il secondo è aperto
    assert entry["cycles"][0]["exit"] is not None
    assert entry["cycles"][1]["exit"] is None
    assert entry["cycles"][1]["entry"]["capital_eur"] == 2000.0


def test_enrich_position_adds_entry_fields(tmp_path: Path):
    log_path = tmp_path / "log.json"
    slopes = {"AAA": _slope(s20=0.42, s5=0.21)}
    update_decision_log(
        positions=[_pos("AAA|2026-06-01", 1000.0)],
        latest_slope_by_ticker=slopes,
        log_path=log_path,
    )
    log = load_decision_log(log_path)
    enriched = enrich_position_with_log(_pos("AAA|2026-06-01", 1000.0), log)
    assert enriched["entry_slope_20d"] == 0.42
    assert enriched["entry_slope_5d"] == 0.21
    assert enriched["entry_affidabilita_pct"] == 75.0
    assert enriched["entry_was_existing"] is True
    assert enriched["decision_cycles_count"] == 1
    assert enriched["decision_current_open"] is True


def test_load_decision_log_missing_file(tmp_path: Path):
    log = load_decision_log(tmp_path / "nonexistent.json")
    assert log["entries"] == {}
    assert log["schema_version"] == 1


def test_corrupted_log_returns_empty(tmp_path: Path):
    p = tmp_path / "bad.json"
    p.write_text("not valid json {{{")
    log = load_decision_log(p)
    assert log["entries"] == {}


def test_position_without_capital_doesnt_create_entry(tmp_path: Path):
    log_path = tmp_path / "log.json"
    # Position con capital=0 viene filtrata fuori dall'update
    log = update_decision_log(
        positions=[_pos("AAA|2026-06-01", 0.0)],
        latest_slope_by_ticker={"AAA": _slope()},
        log_path=log_path,
    )
    assert "AAA|2026-06-01" not in log["entries"]


def test_first_run_with_no_log_file_creates_one(tmp_path: Path):
    log_path = tmp_path / "fresh.json"
    assert not log_path.exists()
    update_decision_log(
        positions=[_pos("AAA|2026-06-01", 500.0)],
        latest_slope_by_ticker={"AAA": _slope()},
        log_path=log_path,
    )
    assert log_path.exists()
    saved = json.loads(log_path.read_text(encoding="utf-8"))
    assert "AAA|2026-06-01" in saved["entries"]
    assert saved["schema_version"] == 1


@pytest.mark.parametrize("entry_existing,expected", [(True, True), (False, False)])
def test_entry_was_existing_flag(tmp_path: Path, entry_existing: bool, expected: bool):
    log_path = tmp_path / "log.json"
    if not entry_existing:
        # Pre-popola con un'altra entry così "is_first_run" sarà False
        update_decision_log(
            positions=[_pos("ZZZ|2026-12-01", 500.0)],
            latest_slope_by_ticker={"ZZZ": _slope()},
            log_path=log_path,
        )
    log = update_decision_log(
        positions=[_pos("AAA|2026-06-01", 1000.0)],
        latest_slope_by_ticker={"AAA": _slope()},
        log_path=log_path,
    )
    snap = log["entries"]["AAA|2026-06-01"]["cycles"][0]["entry"]
    assert snap["entry_was_existing"] is expected
