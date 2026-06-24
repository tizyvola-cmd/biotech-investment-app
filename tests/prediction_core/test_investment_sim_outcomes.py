"""Tests for investment simulation outcomes builder."""
from datetime import date

from prediction.investment_sim_outcomes import (
    _classify_outcome,
    _pred_direction_hit,
    _timing_bucket,
    build_investment_sim_outcomes,
)


def test_timing_bucket_near():
    assert _timing_bucket(5, False) == "pre_cd_near"
    assert _timing_bucket(-3, True) == "post_cd"


def test_classify_outcome_success():
    assert _classify_outcome(500.0, 8.0, True) == "success"
    assert _classify_outcome(100.0, 2.0, False) == "open_success"


def test_pred_direction_hit():
    assert _pred_direction_hit(5.0, 3.0) is True
    assert _pred_direction_hit(5.0, -3.0) is False


def test_build_empty_snapshot(tmp_path):
    snap = tmp_path / "sim.json"
    snap.write_text('{"columns": [], "rows": []}', encoding="utf-8")
    payload = build_investment_sim_outcomes(simulation_path=snap, today=date(2026, 5, 24))
    assert payload["summary"]["n_positions"] == 0


def test_build_one_position(tmp_path):
    snap = tmp_path / "sim.json"
    snap.write_text(
        """{
      "columns": ["Ticker", "Completion Date", "Capitale Investito ($)",
        "Prezzo Acquisto ($)", "Prezzo Corrente ($)", "P&L ($)", "P&L (%)", "Affidabilità\\n%"],
      "rows": [{
        "Ticker": "ANIK",
        "Completion Date": "01/06/2026",
        "Capitale Investito ($)": 10000,
        "Prezzo Acquisto ($)": 5.0,
        "Prezzo Corrente ($)": 5.5,
        "P&L ($)": 500,
        "P&L (%)": 0.05,
        "Affidabilità\\n%": 72
      }]
    }""",
        encoding="utf-8",
    )
    payload = build_investment_sim_outcomes(simulation_path=snap, today=date(2026, 5, 1))
    assert payload["summary"]["n_positions"] == 1
    assert payload["summary"]["win_rate_pct"] == 100.0
    assert payload["rows"][0]["ticker"] == "ANIK"
    assert payload["rows"][0]["buy_signal_result"] in {
        "success",
        "failure",
        "flat",
        "pending",
        "not_applicable",
    }


def test_build_uses_ui_inputs_over_sheet(tmp_path):
    snap = tmp_path / "sim.json"
    snap.write_text(
        """{
      "columns": ["Ticker", "Completion Date", "Capitale Investito ($)",
        "Prezzo Acquisto ($)", "Prezzo Corrente ($)", "P&L ($)", "P&L (%)", "Affidabilità\\n%"],
      "rows": [
        {"Ticker": "ANIK", "Completion Date": "2026-05-31", "Capitale Investito ($)": 10000,
         "Prezzo Acquisto ($)": 20, "Prezzo Corrente ($)": 15, "Affidabilità\\n%": 69},
        {"Ticker": "CNSP", "Completion Date": "2026-05-27", "Prezzo Corrente ($)": 5.05,
         "Affidabilità\\n%": 55},
        {"Ticker": "HURA", "Completion Date": "2026-05-28", "Prezzo Corrente ($)": 3.2,
         "Affidabilità\\n%": 60}
      ]
    }""",
        encoding="utf-8",
    )
    inputs = tmp_path / "inputs.json"
    inputs.write_text(
        """{
      "inputs": {
        "ANIK|2026-05-31": {"buyPrice": 0, "capital": 0, "ignoreSheet": true},
        "CNSP|2026-05-27": {"buyPrice": 5.05, "capital": 1000},
        "HURA|2026-05-28": {"buyPrice": 3.2, "capital": 1000}
      }
    }""",
        encoding="utf-8",
    )
    payload = build_investment_sim_outcomes(
        simulation_path=snap,
        invest_inputs_path=inputs,
        today=date(2026, 5, 24),
    )
    assert payload["summary"]["n_positions"] == 2
    tickers = {r["ticker"] for r in payload["rows"]}
    assert tickers == {"CNSP", "HURA"}
    assert payload["summary"]["total_capital_eur"] == 2000.0
