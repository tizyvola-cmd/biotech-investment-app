"""Test preservazione chiavi P&L Simulation."""
from __future__ import annotations

from simulation_preserve import (
    merge_preserved_into_sim_rows,
    row_key_from_parts,
)


def test_row_key_from_parts():
    assert row_key_from_parts("abc", "2024-01-15") == "ABC|2024-01-15"
    assert row_key_from_parts("xyz", None) == "XYZ"


def test_merge_preserved_into_sim_rows():
    rows = [{"ticker": "MDGL", "completion_date": "2023-01-06"}]
    preserved = {"MDGL|2023-01-06": {"buy_price": 12.5, "capital": 1000.0}}
    n = merge_preserved_into_sim_rows(rows, preserved)
    assert n >= 2
    assert rows[0]["buy_price"] == 12.5
    assert rows[0]["capital"] == 1000.0
