"""Security tests for supernova_api (CORS, local token).

Requires FastAPI and httpx (``TestClient``). Install with::

    pip install fastapi httpx

Or use the project venv::

    .venv\\Scripts\\python.exe -m pytest tests/prediction_core -q
"""
from __future__ import annotations

import importlib

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient

import supernova_config as sn_cfg


def _client(monkeypatch: pytest.MonkeyPatch, **env: str | None) -> TestClient:
    """Fresh app from current env (reload config + API module)."""
    for key, val in env.items():
        if val is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, val)
    sn_cfg.reset_supernova_config()
    import supernova_api

    importlib.reload(supernova_api)
    sn_cfg.reset_supernova_config()
    app = supernova_api.build_app(sn_cfg.SupernovaConfig.from_env())
    return TestClient(app)


def test_cors_rejects_untrusted_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_CORS_PERMISSIVE=None)
    r = client.options(
        "/api/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.headers.get("access-control-allow-origin") != "*"
    assert r.headers.get("access-control-allow-origin") is None


def test_cors_allows_null_origin_for_electron(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_CORS_PERMISSIVE=None)
    r = client.options(
        "/api/health",
        headers={
            "Origin": "null",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.headers.get("access-control-allow-origin") == "null"


def test_cors_allows_localhost_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_CORS_PERMISSIVE=None)
    origin = "http://127.0.0.1:8765"
    r = client.options(
        "/api/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.headers.get("access-control-allow-origin") == origin


def test_cors_permissive_allows_any_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_CORS_PERMISSIVE="1")
    r = client.options(
        "/api/health",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.headers.get("access-control-allow-origin") == "*"


def test_token_required_when_env_set(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_API_TOKEN="secret-test-token")
    r = client.post("/api/orchestrator/run?profile=quick")
    assert r.status_code == 401


def test_token_accepted_when_header_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_API_TOKEN="secret-test-token")
    r = client.post(
        "/api/orchestrator/run?profile=quick",
        headers={sn_cfg.TOKEN_HEADER: "secret-test-token"},
    )
    assert r.status_code != 401


def test_get_routes_no_token_when_env_set(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_API_TOKEN="secret-test-token")
    r = client.get("/api/health")
    assert r.status_code == 200
