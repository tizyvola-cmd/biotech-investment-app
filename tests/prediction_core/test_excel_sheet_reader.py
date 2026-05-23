"""Validazione workbook xlsx per excel_sheet_reader."""
from __future__ import annotations

from pathlib import Path
from zipfile import BadZipFile

import pytest

from excel_sheet_reader import WorkbookReadError, _load_workbook_readonly, _preflight_xlsx


def test_preflight_rejects_empty_file(tmp_path: Path) -> None:
    p = tmp_path / "empty.xlsx"
    p.write_bytes(b"")
    with pytest.raises(WorkbookReadError) as exc:
        _preflight_xlsx(p)
    assert exc.value.status_code == 503
    assert exc.value.cause == "empty_file"


def test_preflight_rejects_non_zip(tmp_path: Path) -> None:
    p = tmp_path / "bad.xlsx"
    p.write_bytes(b"NOTAZIPFILE")
    with pytest.raises(WorkbookReadError) as exc:
        _preflight_xlsx(p)
    assert exc.value.cause == "not_xlsx_zip"


def test_load_workbook_retries_bad_zip(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Primo BadZipFile → attesa 0.5s → secondo tentativo OK."""
    p = tmp_path / "book.xlsx"
    p.write_bytes(b"PK\x03\x04fake")

    calls = {"n": 0}

    class FakeWb:
        sheetnames = ["Simulation"]

        def close(self) -> None:
            pass

    def fake_load(path, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise BadZipFile("not zip")
        return FakeWb()

    import openpyxl

    monkeypatch.setattr(openpyxl, "load_workbook", fake_load)
    monkeypatch.setattr("excel_sheet_reader.time.sleep", lambda _: None)

    wb = _load_workbook_readonly(p)
    assert calls["n"] == 2
    wb.close()


def test_sheet_api_returns_503_on_bad_zip(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    import supernova_config as sn_cfg
    import supernova_api
    import importlib

    bad = tmp_path / "bad.xlsx"
    bad.write_bytes(b"PK\x03\x04truncated")
    monkeypatch.setattr("excel_sheet_reader.FINAL_XLSX", str(bad))

    def boom(*args, **kwargs):
        raise BadZipFile("corrupt")

    import openpyxl

    monkeypatch.setattr(openpyxl, "load_workbook", boom)
    monkeypatch.setattr("excel_sheet_reader.time.sleep", lambda _: None)

    sn_cfg.reset_supernova_config()
    importlib.reload(supernova_api)
    client = TestClient(supernova_api.build_app(sn_cfg.SupernovaConfig.from_env()))
    r = client.get("/api/sheets/simulation")
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "Chiudi Excel" in detail["message_it"]
    assert str(bad) in detail["path"]

    r2 = client.get("/api/sheets/financial")
    assert r2.status_code == 503
    assert "Chiudi Excel" in r2.json()["detail"]["message_it"]
