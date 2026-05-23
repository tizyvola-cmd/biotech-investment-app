"""Unit tests for tools.backtest_v4_baseline (synthetic JSON fixture)."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from tools.backtest_v4_baseline import (
    aggregate_metrics,
    evaluate_record,
    filter_past_rows,
    run_backtest,
)

_FIXTURE = {
    "schema_version": 1,
    "rows": {
        "AAA|2020-06-01": {
            "ticker": "AAA",
            "completion_date": "2020-06-01",
            "dir_v4": "↑ Crescita lieve",
            "score_v4": 80,
            "d3_pct": 6.0,
            "d5_pct": 4.0,
            "model_dm30_pct": 2.0,
            "model_dm7_pct": 1.0,
            "model_d4_pct": 3.0,
            "model_d7_pct": 5.0,
            "curve_act_pct": {"-30": 1.5, "-7": 0.5, "+4": 2.5, "+7": 4.5},
            "close_m30": 110,
            "close_m7": 105,
            "close_p4": 108,
            "close_p7": 112,
            "close_m60": 100,
        },
        "BBB|2030-01-01": {
            "ticker": "BBB",
            "completion_date": "2030-01-01",
            "dir_v4": "↓ Calo lieve",
            "d3_pct": -2.0,
        },
    },
}


def test_filter_past_rows_excludes_future(tmp_path: Path) -> None:
    p = tmp_path / "past.json"
    p.write_text(json.dumps(_FIXTURE), encoding="utf-8")
    rows = filter_past_rows(_FIXTURE["rows"], today=date(2025, 1, 1))
    assert list(rows.keys()) == ["AAA|2020-06-01"]


def test_evaluate_record_direction_and_mae() -> None:
    m = evaluate_record("AAA|2020-06-01", _FIXTURE["rows"]["AAA|2020-06-01"])
    assert m.direction_hit is True
    assert m.brier is not None
    assert m.incoherent is False
    assert m.curve_mae["T-30"] == 0.5
    assert m.curve_mae["T-7"] == 0.5


def test_run_backtest_writes_csv(tmp_path: Path) -> None:
    p = tmp_path / "past.json"
    p.write_text(json.dumps(_FIXTURE), encoding="utf-8")
    csv_out = tmp_path / "out.csv"
    summary, metrics = run_backtest(p, csv_path=csv_out, today=date(2025, 1, 1))
    assert summary["n_rows"] == 1
    assert len(metrics) == 1
    assert csv_out.is_file()
    agg = aggregate_metrics(metrics)
    assert agg["direction_hit_rate"] == 1.0
