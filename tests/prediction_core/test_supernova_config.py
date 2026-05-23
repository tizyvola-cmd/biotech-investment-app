"""Tests for supernova_config (no FastAPI dependency).

For API security tests see ``test_supernova_api.py`` (needs ``fastapi`` + ``httpx``).
Install with ``pip install fastapi httpx`` or ``pip install -r requirements-dev.txt`` in the project venv.
"""
from __future__ import annotations

import supernova_config as cfg


def test_from_env_defaults(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.delenv("SUPERNOVA_CORS_PERMISSIVE", raising=False)
    monkeypatch.delenv("SUPERNOVA_BIND_ALL", raising=False)
    monkeypatch.delenv("SUPERNOVA_API_TOKEN", raising=False)
    c = cfg.SupernovaConfig.from_env()
    assert c.cors_permissive is False
    assert c.bind_all is False
    assert c.api_token is None
    assert c.uvicorn_host == "127.0.0.1"
    assert c.uvicorn_port == cfg.DEFAULT_PORT


def test_bind_all_host(monkeypatch):
    monkeypatch.setenv("SUPERNOVA_BIND_ALL", "1")
    c = cfg.SupernovaConfig.from_env()
    assert c.bind_all is True
    assert c.uvicorn_host == "0.0.0.0"
