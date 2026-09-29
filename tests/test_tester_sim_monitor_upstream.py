"""Regression tests for the tester sim-monitor upstream proxy."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import tester_sim_monitor as tsm


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # noqa: D401
        return None


def _fake_urlopen_ok(req, timeout: float):  # noqa: ARG001
    return _FakeResponse(
        {
            "generated_at": "2026-01-01T00:00:00+00:00",
            "sim_snapshot_available": True,
            "aggregate": {"tester_count": 1, "total_open_positions": 1},
            "testers": [{"tester_id": "mock", "positions": [{"ticker": "MOCK"}]}],
        }
    )


def _fake_urlopen_broken(req, timeout: float):  # noqa: ARG001
    raise TimeoutError("upstream unreachable")


def test_upstream_env_proxies_response(monkeypatch) -> None:
    monkeypatch.setenv(tsm.UPSTREAM_ENV, "http://vps.example:8765")
    with patch("tester_sim_monitor.urllib.request.urlopen", side_effect=_fake_urlopen_ok):
        payload = tsm.build_sim_monitor()

    assert payload["upstream_url"] == "http://vps.example:8765"
    assert "upstream_fetched_at" in payload
    assert payload["aggregate"]["tester_count"] == 1
    assert payload["testers"][0]["tester_id"] == "mock"


def test_upstream_env_falls_back_to_local_on_error(monkeypatch) -> None:
    monkeypatch.setenv(tsm.UPSTREAM_ENV, "http://vps.example:8765")
    with (
        patch("tester_sim_monitor.urllib.request.urlopen", side_effect=_fake_urlopen_broken),
        patch("tester_sim_monitor._iter_tester_files", return_value=[]),
        patch("tester_sim_monitor._load_sim_sheet_rows", return_value=[]),
        patch("tester_sim_monitor.load_store", return_value={}),
    ):
        payload = tsm.build_sim_monitor()

    # Fallback → dati locali: nessun upstream_url, aggregate presente, 0 tester.
    assert "upstream_url" not in payload
    assert payload["aggregate"]["tester_count"] == 0
    assert payload["testers"] == []


def test_no_upstream_env_reads_local(monkeypatch) -> None:
    monkeypatch.delenv(tsm.UPSTREAM_ENV, raising=False)
    with (
        patch("tester_sim_monitor._iter_tester_files", return_value=[]),
        patch("tester_sim_monitor._load_sim_sheet_rows", return_value=[]),
        patch("tester_sim_monitor.load_store", return_value={}),
    ):
        payload = tsm.build_sim_monitor()

    assert "upstream_url" not in payload
    assert payload["aggregate"]["tester_count"] == 0
