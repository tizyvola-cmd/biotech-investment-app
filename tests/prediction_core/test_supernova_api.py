"""Security tests for supernova_api (CORS, local token).

Requires FastAPI and httpx (``TestClient``). Install with::

    pip install fastapi httpx

Or use the project venv::

    .venv\\Scripts\\python.exe -m pytest tests/prediction_core -q
"""
from __future__ import annotations

import importlib
from pathlib import Path

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


def test_manifest_endpoint(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import json

    import supernova_api

    manifest = {"updated_at": "2026-05-29T10:00:00+00:00", "sheets": {}}
    p = tmp_path / "desktop_data_manifest.json"
    p.write_text(json.dumps(manifest), encoding="utf-8")
    client = _client(monkeypatch, SUPERNOVA_SERVE_DESKTOP=None)
    monkeypatch.setattr(supernova_api, "DESKTOP_DATA_MANIFEST_JSON", str(p))
    r = client.get("/api/desktop/manifest")
    assert r.status_code == 200
    assert r.json().get("updated_at") == manifest["updated_at"]


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


def test_mobile_tester_register_no_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_API_TOKEN="secret-test-token")
    r = client.post(
        "/api/tester-feedback/testers/register",
        json={
            "email": "mobile@test.example",
            "tester_id": "mobile_at_test.example",
            "display_name": "Mobile",
            "source": "mobile",
        },
    )
    assert r.status_code != 401
    assert r.status_code == 200
    assert r.json()["tester"]["status"] == "pending"


def test_tester_status_still_requires_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(monkeypatch, SUPERNOVA_API_TOKEN="secret-test-token")
    r = client.post(
        "/api/tester-feedback/testers/foo/status",
        json={"status": "approved"},
    )
    assert r.status_code == 401
