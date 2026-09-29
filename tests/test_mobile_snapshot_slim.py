"""Tests for slim mobile snapshot split + quotes cache."""
from __future__ import annotations

import json
from pathlib import Path

import mobile_snapshot_io as msi
import quotes_batch_cache as qbc


def test_split_snapshot_strips_charts(tmp_path, monkeypatch):
    snap = tmp_path / "mobile_dashboard_snapshot.json"
    charts = tmp_path / "mobile_curve_charts.json"
    monkeypatch.setattr(msi, "SNAPSHOT_PATH", snap)
    monkeypatch.setattr(msi, "CURVE_CHARTS_PATH", charts)

    payload = {
        "version": 1,
        "updated_at": "2026-09-21T12:00:00Z",
        "softBuys": [{"key": "AAA|2026-01-01"}],
        "recommendations": [
            {"key": "AAA|2026-01-01", "curveCharts": {"predBlend": [1, 2, 3]}},
        ],
        "curveChartsByKey": {
            "AAA|2026-01-01": {"predBlend": [{"t": 0}], "polygon": {"labels": ["a"]}},
        },
    }
    info = msi.write_split_snapshot(payload)
    assert info["chart_keys"] == 1
    slim = json.loads(snap.read_text(encoding="utf-8"))
    assert "curveChartsByKey" not in slim
    assert "curveCharts" not in slim["recommendations"][0]
    doc = json.loads(charts.read_text(encoding="utf-8"))
    assert "AAA|2026-01-01" in doc["curveChartsByKey"]
    assert msi.curve_chart_for_key("AAA|2026-01-01") is not None


def test_ensure_split_on_legacy_file(tmp_path, monkeypatch):
    snap = tmp_path / "mobile_dashboard_snapshot.json"
    charts = tmp_path / "mobile_curve_charts.json"
    monkeypatch.setattr(msi, "SNAPSHOT_PATH", snap)
    monkeypatch.setattr(msi, "CURVE_CHARTS_PATH", charts)
    snap.write_text(
        json.dumps(
            {
                "updated_at": "t",
                "curveChartsByKey": {"X|Y": {"predBlend": []}},
                "softBuys": [],
            }
        ),
        encoding="utf-8",
    )
    out = msi.ensure_split_on_disk()
    assert out["ok"] is True
    assert out.get("split") is True
    slim = json.loads(snap.read_text(encoding="utf-8"))
    assert "curveChartsByKey" not in slim
    assert charts.is_file()


def test_quotes_from_financial_snapshot(tmp_path, monkeypatch):
    fin = tmp_path / "financial_sheet_snapshot.json"
    fin.write_text(
        json.dumps(
            {
                "rows": [
                    {
                        "symbol": "MRNA",
                        "currentPrice": 12.5,
                        "dailyChange_%": -1.2,
                        "volume": 1000,
                        "beta": 1.1,
                        "marketCap": 9e9,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        qbc,
        "FINANCIAL_SHEET_SNAPSHOT_JSON",
        str(fin),
    )
    # Path is imported into module at load — patch the Path usage via env of constant
    import quotes_batch_cache as mod

    monkeypatch.setattr(
        "quotes_batch_cache.FINANCIAL_SHEET_SNAPSHOT_JSON",
        str(fin),
    )
    mod._cache = None
    mod._cache_mtime = None
    out = mod.batch_quotes(["mrna", "ZZZ"], live_fallback=False)
    assert "MRNA" in out["quotes"]
    assert out["quotes"]["MRNA"]["price"] == 12.5
    assert out["quotes"]["MRNA"]["source"] == "financial_sheet_snapshot"
    assert "ZZZ" in out["meta"]["missing"]
