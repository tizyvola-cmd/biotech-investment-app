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


def test_sds_refresh_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_SDS_REFRESH", "1")
    monkeypatch.setenv("SUPERNOVA_SDS_REFRESH_TIME", "09:15")
    c = cfg.SupernovaConfig.from_env()
    assert c.sds_refresh_enabled is True
    assert c.sds_refresh_time == "09:15"


def test_model_lab_refresh_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_MODEL_LAB_REFRESH", "1")
    monkeypatch.setenv("SUPERNOVA_MODEL_LAB_REFRESH_TIME", "16:30")
    c = cfg.SupernovaConfig.from_env()
    assert c.model_lab_refresh_enabled is True
    assert c.model_lab_refresh_time == "16:30"


def test_saturday_weekly_full_env(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL", "1")
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME", "07:30")
    monkeypatch.setenv("SUPERNOVA_SATURDAY_WEEKLY_FULL_END", "13:00")
    c = cfg.SupernovaConfig.from_env()
    assert c.saturday_weekly_full_enabled is True
    assert c.saturday_weekly_full_time == "07:30"
    assert c.saturday_weekly_full_window_end == "13:00"
